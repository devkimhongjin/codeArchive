import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT,
  CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS,
  selectAckableClientRecordIds,
  toMainApiSolutionBulkUpsertRecord,
  type CaptureImportRecord,
  type MainApiSolutionBulkUpsertRequest,
} from "../../../packages/shared-types/src";
import type { DashboardExtensionConnection } from "./extensionConnection";
import { MAIN_API_ORIGIN } from "./authClient";

const BULK_UPSERT_URL = `${MAIN_API_ORIGIN}/api/v1/solutions/bulk-upsert`;

const PLATFORMS = new Set(["SWEA", "PROGRAMMERS", "JUNGOL", "LEETCODE"]);
const LANGUAGES = new Set(["JAVA", "PYTHON", "C", "CPP", "JAVASCRIPT", "TYPESCRIPT", "KOTLIN", "CSHARP", "GO", "RUST", "SWIFT"]);
const RESULTS = new Set(["ACCEPTED", "WRONG_ANSWER", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED", "RUNTIME_ERROR", "COMPILE_ERROR", "OUTPUT_FORMAT_ERROR", "PARTIAL_SCORE", "UNKNOWN"]);
const BULK_UPSERT_FAILURE_CODES = new Set(["INVALID_RECORD", "PERSISTENCE_FAILED"]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PendingDrainRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[];
  delay(milliseconds: number): Promise<void>;
}

export interface PendingDrainApiClient {
  upsert(
    importBatchId: string,
    records: readonly CaptureImportRecord[],
    canContinue?: () => boolean,
  ): Promise<readonly string[] | null>;
}

export interface PendingDrainController {
  schedule(syncSessionId: string): void;
  invalidate(): void;
  isRunning(): boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export function isCaptureImportRecord(value: unknown): value is CaptureImportRecord {
  if (!isObject(value) || !isObject(value.problem)) return false;
  const problem = value.problem;
  return typeof value.clientRecordId === "string" && value.clientRecordId.length > 0
    && typeof value.code === "string"
    && typeof value.submittedAt === "string" && value.submittedAt.length > 0
    && typeof value.language === "string" && LANGUAGES.has(value.language)
    && typeof value.result === "string" && RESULTS.has(value.result)
    && optionalFiniteNumber(value.executionTime)
    && optionalFiniteNumber(value.memoryUsage)
    && typeof problem.platform === "string" && PLATFORMS.has(problem.platform)
    && typeof problem.platformProblemId === "string" && problem.platformProblemId.length > 0
    && typeof problem.title === "string"
    && typeof problem.url === "string"
    && optionalString(problem.problemNumber)
    && optionalString(problem.slug)
    && optionalString(problem.difficulty)
    && Array.isArray(problem.tags)
    && problem.tags.every((tag) => typeof tag === "string");
}

export interface ValidPendingPage {
  readonly records: readonly CaptureImportRecord[];
  readonly nextCursor?: string;
}

export function parsePendingPage(value: unknown): ValidPendingPage | null {
  if (!isObject(value) || value.ok !== true || !isObject(value.data)) return null;
  const data = value.data;
  if (
    data.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    || data.scope !== "pending"
    || !Array.isArray(data.records)
    || data.records.length > CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT
    || !Number.isInteger(data.revision)
    || (data.revision as number) < 0
    || !(data.nextCursor === undefined || (typeof data.nextCursor === "string" && data.nextCursor.length > 0))
  ) return null;
  if (!data.records.every(isCaptureImportRecord)) return null;
  const ids = data.records.map((record) => record.clientRecordId);
  if (new Set(ids).size !== ids.length) return null;
  return {
    records: data.records,
    ...(typeof data.nextCursor === "string" ? { nextCursor: data.nextCursor } : {}),
  };
}

function isValidBulkUpsertResult(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  if (typeof value.clientRecordId !== "string" || value.clientRecordId.length === 0) return false;

  if (value.outcome === "IMPORTED" || value.outcome === "EXISTING") {
    return value.ackEligible === true && value.errorCode === null;
  }

  if (value.outcome === "FAILED") {
    return value.ackEligible === false
      && typeof value.errorCode === "string"
      && BULK_UPSERT_FAILURE_CODES.has(value.errorCode);
  }

  return false;
}

function parseAckableApiIds(value: unknown, offeredIds: readonly string[]): readonly string[] | null {
  if (!isObject(value) || value.success !== true || value.error !== null || !isObject(value.data)) return null;
  if (typeof value.requestId !== "string" || !Array.isArray(value.data.results)) return null;

  const results = value.data.results;
  if (!results.every(isValidBulkUpsertResult)) return null;

  const resultIds = results.map((result) => result.clientRecordId as string);
  if (new Set(resultIds).size !== resultIds.length) return null;

  const offered = new Set(offeredIds);
  return selectAckableClientRecordIds(results).filter((id) => offered.has(id));
}

const DEFAULT_RETRY_POLICY: PendingDrainRetryPolicy = {
  maxAttempts: 3,
  backoffMs: [250, 1_000],
  delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createPendingDrainApiClient(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
  retryPolicy: PendingDrainRetryPolicy = DEFAULT_RETRY_POLICY,
): PendingDrainApiClient {
  return {
    async upsert(importBatchId, records, canContinue = () => true) {
      const request: MainApiSolutionBulkUpsertRequest = {
        importBatchId,
        records: records.map(toMainApiSolutionBulkUpsertRecord),
      };
      const requestBody = JSON.stringify(request);
      const attempts = Math.max(1, Math.floor(retryPolicy.maxAttempts));

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) {
          if (!canContinue()) return null;
          const delayIndex = Math.min(attempt - 1, retryPolicy.backoffMs.length - 1);
          const delayMs = delayIndex >= 0 ? retryPolicy.backoffMs[delayIndex] : 0;
          await retryPolicy.delay(delayMs);
          if (!canContinue()) return null;
        }

        try {
          const response = await fetcher(BULK_UPSERT_URL, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
          });
          if (response.ok) {
            try {
              return parseAckableApiIds(await response.json(), records.map((record) => record.clientRecordId));
            } catch {
              return null;
            }
          }
          if (!isTransientStatus(response.status)) return null;
        } catch {
          // Network failures are transient; retry only within the bounded policy.
        }
      }

      return null;
    },
  };
}

export const dashboardPendingDrainApiClient = createPendingDrainApiClient();

export function secureImportBatchId(): string {
  return globalThis.crypto.randomUUID();
}

export function createPendingDrainController(
  bridge: DashboardExtensionConnection,
  api: PendingDrainApiClient = dashboardPendingDrainApiClient,
  generateImportBatchId: () => string = secureImportBatchId,
  isEligible: (syncSessionId: string) => boolean = () => true,
  onServerRecordsChanged: () => void = () => undefined,
): PendingDrainController {
  let generation = 0;
  let running = false;
  let scheduledSessionId: string | null = null;

  const stillEligible = (sessionId: string, runGeneration: number) =>
    generation === runGeneration && isEligible(sessionId);

  const drain = async (sessionId: string, runGeneration: number) => {
    const beginImport = bridge.beginImport;
    const readPendingPage = bridge.readPendingPage;
    const ackImported = bridge.ackImported;
    if (!beginImport || !readPendingPage || !ackImported) return;
    if (!stillEligible(sessionId, runGeneration)) return;
    const capability = await beginImport(sessionId);
    if (!capability || !stillEligible(sessionId, runGeneration)) return;

    let cursor: string | undefined;
    for (let pageCount = 0; pageCount < CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS; pageCount += 1) {
      if (!stillEligible(sessionId, runGeneration)) return;
      const rawPage = await readPendingPage(capability, cursor);
      if (!stillEligible(sessionId, runGeneration)) return;
      const page = parsePendingPage(rawPage);
      if (!page) return;

      if (page.records.length > 0) {
        const importBatchId = generateImportBatchId();
        if (!stillEligible(sessionId, runGeneration)) return;
        const ackableIds = await api.upsert(
          importBatchId,
          page.records,
          () => stillEligible(sessionId, runGeneration),
        );
        if (!stillEligible(sessionId, runGeneration)) return;
        if (ackableIds === null) return;
        if (ackableIds.length > 0) {
          onServerRecordsChanged();
          await ackImported(capability, importBatchId, ackableIds);
          if (!stillEligible(sessionId, runGeneration)) return;
        }
      }

      if (!page.nextCursor) return;
      cursor = page.nextCursor;
    }
  };

  const pump = async () => {
    if (running || !scheduledSessionId) return;
    running = true;
    try {
      while (scheduledSessionId) {
        const sessionId = scheduledSessionId;
        scheduledSessionId = null;
        const runGeneration = generation;
        await drain(sessionId, runGeneration);
      }
    } finally {
      running = false;
      if (scheduledSessionId) void pump();
    }
  };

  return {
    schedule(syncSessionId) {
      scheduledSessionId = syncSessionId;
      void pump();
    },
    invalidate() {
      generation += 1;
      scheduledSessionId = null;
    },
    isRunning() {
      return running;
    },
  };
}
