import { CODEARCHIVE_API_BASE_URL } from "../apiConfig";
import {
  listRelayPendingCaptures,
  markRelayConflictsForRecords,
  markRelayConflictsIfCurrent,
  markRelayImportReceiptsIfCurrent,
  nextRelayCaptureEligibility,
  type RelayAuthoritySnapshot,
  type RelayStateSnapshot,
} from "../solutionRepository";
import type { SolutionRecord } from "../solution";
import {
  indexedDbRelayStateRepository,
  normalizeRelayFailure,
  type RelayFailureCategory,
  type RelayFailureDiagnostic,
  type RelayStateRecord,
  type RelayStateRepository,
} from "./relayState";
import type { CodeArchiveAutomationState } from "../../../../packages/shared-types/src";

export const RELAY_DRAIN_ALARM = "codearchive-relay-drain";
const RETRY_DELAYS_MS = [60_000, 180_000, 600_000, 1_800_000, 3_600_000] as const;
const COLD_START_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 1_800_000] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RECORD_CODE_CHARS = 200_000;
const MAX_BATCH_CODE_CHARS = 1_000_000;

export interface RelayAlarmApi {
  create(name: string, info: { when: number }): Promise<void> | void;
  clear(name: string): Promise<boolean> | boolean;
  onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
}

export interface RelayFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type RelayFetch = (input: string, init: RequestInit) => Promise<RelayFetchResponse>;

export interface RelayRuntimeDependencies {
  state?: RelayStateRepository;
  alarms?: RelayAlarmApi;
  fetch?: RelayFetch;
  now?: () => number;
  listPending?: (grantId: string, generation: number, limit?: number) => Promise<SolutionRecord[]>;
  nextEligibleAt?: (grantId: string, generation: number) => Promise<number | undefined>;
  markImported?: (ids: readonly string[], at: string) => Promise<void>;
  markConflicts?: (ids: readonly string[], at: string, errorCode?: string) => Promise<void>;
  markInvalid?: (records: readonly SolutionRecord[], at: string, errorCode: string) => Promise<void>;
}

export interface RelayPopupState {
  state: RelayStateRecord["state"];
  autoSyncEnabled: boolean;
  grantId?: string;
  generation?: number;
  lastFailure?: RelayFailureDiagnostic;
  readStatus?: "ready" | "error";
  nextRetryAt?: string;
}

type AuthorityBoundRecordMutation = (
  ids: readonly string[],
  at: string,
  authority: RelayAuthoritySnapshot,
  errorCode?: string,
) => Promise<boolean>;

interface RelayFailureInput {
  category: RelayFailureCategory;
  status?: number;
  requestId?: string;
  errorCode?: string;
}

function isStateActive(state: RelayStateRecord, now: number): boolean {
  return state.state === "ACTIVE" && typeof state.grantId === "string" && state.grantId.length > 0
    && typeof state.credential === "string" && state.credential.length > 0
    && Number.isSafeInteger(state.generation) && (state.generation as number) > 0
    && typeof state.expiresAt === "string" && Date.parse(state.expiresAt) > now;
}

function validAbsoluteTimestamp(value: unknown): value is string {
  return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim()) && Number.isFinite(Date.parse(value));
}

function solvedAtWireValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T00:00:00+09:00`)
    : validAbsoluteTimestamp(trimmed) ? Date.parse(trimmed) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function validBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function relayRecordError(record: SolutionRecord, grantId: string, generation: number, now: number): string | undefined {
  if (!validBoundedText(record.clientRecordId, 128)) return "RELAY_RECORD_INVALID";
  if (record.platform !== "SWEA" && record.platform !== "PROGRAMMERS") return "RELAY_RECORD_INVALID";
  if (!validBoundedText(record.problemNumber, 64) || !validBoundedText(record.title, 255) || !validBoundedText(record.language, 64)) return "RELAY_RECORD_INVALID";
  if (typeof record.code !== "string" || record.code.trim().length === 0) return "RELAY_RECORD_INVALID";
  if (record.code.length > MAX_RECORD_CODE_CHARS) return "RELAY_RECORD_TOO_LARGE";
  if (record.autoCapture?.result !== "ACCEPTED") return "RELAY_RECORD_INVALID";
  if (!solvedAtWireValue(record.solvedAt) || !validAbsoluteTimestamp(record.autoCapture.observedAt)) return "RELAY_RECORD_INVALID";
  if (!validAbsoluteTimestamp(record.relayCapture?.capturedAt) || Date.parse(record.relayCapture.capturedAt) > now + 300_000) return "RELAY_RECORD_INVALID";
  if (record.relayCapture?.grantId !== grantId) return "RELAY_RECORD_INVALID";
  if (!Number.isSafeInteger(record.relayCapture?.generation) || record.relayCapture.generation !== generation) return "RELAY_RECORD_INVALID";
  if (record.performance && (!validBoundedText(record.performance.executionTime, 128) || !validBoundedText(record.performance.memoryUsage, 128))) return "RELAY_RECORD_INVALID";
  if (record.aiUsage !== "used" && record.aiUsage !== "not_used" && record.aiUsage !== "unknown") return "RELAY_RECORD_INVALID";
  return undefined;
}

function payload(record: SolutionRecord) {
  return {
    clientRecordId: record.clientRecordId?.trim(),
    platform: record.platform,
    problemNumber: record.problemNumber.trim(),
    title: record.title.trim(),
    language: record.language.trim(),
    code: record.code,
    result: "ACCEPTED",
    solvedAt: solvedAtWireValue(record.solvedAt),
    observedAt: record.autoCapture?.observedAt ?? record.updatedAt,
    capturedAt: record.relayCapture?.capturedAt,
    executionTime: record.performance?.executionTime.trim() ?? null,
    memoryUsage: record.performance?.memoryUsage.trim() ?? null,
    aiUsage: record.aiUsage,
  };
}

function retryAfterMs(response: RelayFetchResponse, now: number): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDashboardControllerUnavailable(state: CodeArchiveAutomationState): boolean {
  return state.connectionAvailable === false && state.errorCode === "DASHBOARD_DISCONNECTED";
}

function authoritySnapshot(state: RelayStateRecord): RelayAuthoritySnapshot {
  return {
    revision: state.revision,
    deviceId: state.deviceId,
    grantId: state.grantId as string,
    generation: state.generation as number,
    credential: state.credential as string,
  };
}

function authoritySnapshotIfPresent(state: RelayStateRecord): RelayAuthoritySnapshot | undefined {
  if (typeof state.deviceId !== "string" || !state.deviceId
    || typeof state.grantId !== "string" || !state.grantId
    || !Number.isSafeInteger(state.generation) || (state.generation as number) <= 0
    || typeof state.credential !== "string" || !state.credential) return undefined;
  return authoritySnapshot(state);
}

function authorityStillCurrent(state: RelayStateRecord, authority: RelayAuthoritySnapshot): boolean {
  // Revision is intentionally not required to remain equal: retry counters and
  // other bookkeeping can advance it without changing the relay authority.
  // Grant/device/credential identity plus the active intent gate ownership.
  return state.state === "ACTIVE"
    && state.autoSyncEnabled === true
    && state.deviceId === authority.deviceId
    && state.grantId === authority.grantId
    && state.generation === authority.generation
    && state.credential === authority.credential;
}

function safeResponseText(value: unknown, max: number, pattern: RegExp): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max && pattern.test(value) ? value : undefined;
}

function responseMetadata(response: RelayFetchResponse, body: unknown): Pick<RelayFailureDiagnostic, "requestId" | "errorCode"> {
  const requestId = safeResponseText(
    response.headers.get("X-Request-Id") ?? response.headers.get("X-Request-ID"),
    128,
    /^[A-Za-z0-9._:-]+$/,
  );
  if (!body || typeof body !== "object" || Array.isArray(body)) return requestId ? { requestId } : {};
  const envelope = body as Record<string, unknown>;
  const bodyRequestId = safeResponseText(envelope.requestId, 128, /^[A-Za-z0-9._:-]+$/);
  const error = envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)
    ? envelope.error as Record<string, unknown>
    : undefined;
  const errorCode = safeResponseText(error?.code ?? envelope.errorCode, 64, /^[A-Z0-9_:-]+$/);
  return {
    ...(requestId ?? bodyRequestId ? { requestId: requestId ?? bodyRequestId } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

export class RelayRuntime {
  private readonly state: RelayStateRepository;
  private readonly alarms?: RelayAlarmApi;
  private readonly request: RelayFetch;
  private readonly now: () => number;
  private readonly listPending: (grantId: string, generation: number, limit?: number) => Promise<SolutionRecord[]>;
  private readonly nextEligibleAt: (grantId: string, generation: number) => Promise<number | undefined>;
  private readonly markImported: AuthorityBoundRecordMutation;
  private readonly markConflicts: AuthorityBoundRecordMutation;
  private readonly markInvalid: (records: readonly SolutionRecord[], at: string, errorCode: string) => Promise<void>;
  private running = false;
  private blocked = false;
  private alarmQueue: Promise<void> = Promise.resolve();

  constructor(dependencies: RelayRuntimeDependencies = {}) {
    this.state = dependencies.state ?? indexedDbRelayStateRepository;
    this.alarms = dependencies.alarms ?? (globalThis as { chrome?: { alarms?: RelayAlarmApi } }).chrome?.alarms;
    this.request = dependencies.fetch ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? (() => Date.now());
    this.listPending = dependencies.listPending ?? listRelayPendingCaptures;
    this.nextEligibleAt = dependencies.nextEligibleAt ?? nextRelayCaptureEligibility;
    this.markImported = dependencies.markImported
      ? async (ids, at, authority) => {
        if (!authorityStillCurrent(await this.state.get(), authority)) return false;
        await dependencies.markImported!(ids, at);
        return true;
      }
      : async (ids, at, authority) => markRelayImportReceiptsIfCurrent(ids, at, authority);
    this.markConflicts = dependencies.markConflicts
      ? async (ids, at, authority, errorCode) => {
        if (!authorityStillCurrent(await this.state.get(), authority)) return false;
        await dependencies.markConflicts!(ids, at, errorCode);
        return true;
      }
      : async (ids, at, authority, errorCode) => markRelayConflictsIfCurrent(ids, at, authority, errorCode);
    this.markInvalid = dependencies.markInvalid ?? markRelayConflictsForRecords;
  }

  start(): void {
    this.alarms?.onAlarm.addListener((alarm) => {
      if (alarm.name === RELAY_DRAIN_ALARM) void this.drain();
    });
    void this.reconstruct();
  }

  async onCaptureCommitted(): Promise<void> {
    await this.scheduleIfEligible().catch(() => undefined);
    // Keep the persisted alarm as the service-worker/restart safety net, but also
    // attempt one bounded drain while this capture notification is still alive.
    // The capture path is fire-and-forget, so a transient request failure remains
    // covered by retry/backoff without delaying local persistence.
    await this.drain().catch(() => undefined);
  }

  async getPopupState(): Promise<RelayPopupState> {
    const state = await this.state.get();
    return {
      state: state.state,
      autoSyncEnabled: state.autoSyncEnabled === true,
      ...(state.grantId ? { grantId: state.grantId } : {}),
      ...(state.generation ? { generation: state.generation } : {}),
      ...(state.lastFailure ? { lastFailure: state.lastFailure } : {}),
      ...(state.nextRetryAt ? { nextRetryAt: state.nextRetryAt } : {}),
      readStatus: "ready",
    };
  }

  async stopLocally(): Promise<RelayPopupState> {
    this.blocked = true;
    await this.disableLocalRelay();
    return this.getPopupState();
  }

  async retryNow(): Promise<RelayPopupState> {
    await this.drain({ ignoreRetry: true }).catch(() => undefined);
    return this.getPopupState();
  }

  async onAutomationState(state: CodeArchiveAutomationState): Promise<void> {
    if (state.errorCode === "MULTIPLE_DASHBOARD_TABS") {
      this.blocked = true;
      await this.cancelAlarm();
      return;
    }
    // Dashboard controller/Port availability is not durable relay authority.
    // A confirmed relay must remain armed after the Dashboard document is gone.
    if (isDashboardControllerUnavailable(state)) return;
    if (!state.authenticated || !state.autoSyncEnabled) {
      this.blocked = true;
      await this.disableLocalRelay();
      return;
    }
    this.blocked = false;
    await this.state.update((current) => ({ ...current, autoSyncEnabled: true, failureCount: 0, nextRetryAt: undefined }));
    await this.scheduleIfEligible();
  }

  onMultipleDashboardTabs(): void {
    this.blocked = true;
    void this.cancelAlarm();
  }

  async onLogoutOrAccountChange(): Promise<void> {
    this.blocked = true;
    await this.disableLocalRelay();
  }

  private async reconstruct(): Promise<void> {
    try {
      const state = await this.state.get();
      if (state.state === "ACTIVE" && !isStateActive(state, this.now())) {
        await this.invalidate("EXPIRED", { category: "LOCAL_EXPIRED" }, authoritySnapshotIfPresent(state));
      } else if (isStateActive(state, this.now()) && state.autoSyncEnabled) await this.scheduleIfEligible();
    } catch { /* fail closed; pairing or next capture can reconstruct the state */ }
  }

  private async scheduleIfEligible(delayMs = 0, authority?: RelayAuthoritySnapshot): Promise<void> {
    if (!this.alarms || this.blocked) return;
    const state = await this.state.get();
    if (authority && !authorityStillCurrent(state, authority)) return;
    if (state.state === "ACTIVE" && !isStateActive(state, this.now())) {
      await this.invalidate("EXPIRED", { category: "LOCAL_EXPIRED" }, authority ?? authoritySnapshotIfPresent(state));
      return;
    }
    if (!isStateActive(state, this.now()) || !state.autoSyncEnabled) return;
    await this.enqueueAlarmOperation(async () => {
      if (this.blocked) return;
      const current = await this.state.get();
      if (authority && !authorityStillCurrent(current, authority)) return;
      if (!isStateActive(current, this.now()) || !current.autoSyncEnabled) return;
      await this.alarms?.create(RELAY_DRAIN_ALARM, { when: this.now() + Math.max(0, delayMs) });
    });
  }

  private enqueueAlarmOperation(operation: () => Promise<void> | void): Promise<void> {
    const next = this.alarmQueue.then(operation, operation);
    this.alarmQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async cancelAlarm(authority?: RelayAuthoritySnapshot): Promise<void> {
    if (!this.alarms) return;
    await this.enqueueAlarmOperation(async () => {
      await this.alarms!.clear(RELAY_DRAIN_ALARM);
      if (!authority) return;
      const current = await this.state.get();
      if (!isStateActive(current, this.now()) || !current.autoSyncEnabled) return;
      // The clear may have raced with a rotation (or a reactivation). Once the
      // clear completes, any currently eligible relay must receive a fresh
      // alarm; otherwise the old cleanup can erase a newer grant's schedule.
      await this.alarms!.create(RELAY_DRAIN_ALARM, {
        when: this.now() + (current.nextRetryAt ? Math.max(0, Date.parse(current.nextRetryAt) - this.now()) : 0),
      });
    });
  }

  private async disableLocalRelay(): Promise<void> {
    await this.cancelAlarm();
    await this.state.update((current) => ({
      ...current,
      state: current.state === "ACTIVE" && current.grantId && current.generation ? "REVOCATION_PENDING" : current.state,
      credential: undefined,
      autoSyncEnabled: false,
      signedChallengeId: undefined,
      signedChallengeExpiresAt: undefined,
      provisionedChallengeId: undefined,
      nextRetryAt: undefined,
    }));
  }

  async drain(options: { ignoreRetry?: boolean } = {}): Promise<void> {
    if (this.running || this.blocked) return;
    this.running = true;
    try {
      const state = await this.state.get();
      if (state.state === "ACTIVE" && !isStateActive(state, this.now())) {
        await this.invalidate("EXPIRED", { category: "LOCAL_EXPIRED" }, authoritySnapshotIfPresent(state));
        return;
      }
      if (!isStateActive(state, this.now()) || !state.autoSyncEnabled) return;
      if (state.nextRetryAt && Date.parse(state.nextRetryAt) > this.now()) {
        if (options.ignoreRetry) {
          await this.state.update((current) => authorityStillCurrent(current, authoritySnapshot(state)) ? { ...current, nextRetryAt: undefined } : current);
        } else {
          await this.scheduleIfEligible(Date.parse(state.nextRetryAt) - this.now());
          return;
        }
      }
      const grantId = state.grantId as string;
      const generation = state.generation as number;
      const requestAuthority = authoritySnapshot(state);
      const candidates = (await this.listPending(grantId, generation, 25)).filter((record) => record.relayCapture?.grantId === grantId && record.relayCapture?.generation === generation);
      const invalidByReason = new Map<string, SolutionRecord[]>();
      const validRecords: SolutionRecord[] = [];
      for (const record of candidates) {
        const errorCode = relayRecordError(record, grantId, generation, this.now());
        if (errorCode) invalidByReason.set(errorCode, [...(invalidByReason.get(errorCode) ?? []), record]);
        else validRecords.push(record);
      }
      for (const [errorCode, invalidRecords] of invalidByReason) {
        await this.markInvalid(invalidRecords, new Date(this.now()).toISOString(), errorCode);
      }
      let batchCodeChars = 0;
      const records = validRecords
        .filter((record) => {
          if (batchCodeChars + record.code.length > MAX_BATCH_CODE_CHARS) return false;
          batchCodeChars += record.code.length;
          return true;
        });
      if (records.length === 0) {
        const nextEligibleAt = await this.nextEligibleAt(grantId, generation).catch(() => undefined);
        if (nextEligibleAt && nextEligibleAt > this.now()) await this.scheduleIfEligible(nextEligibleAt - this.now());
        return;
      }
      const ids = records.map((record) => record.clientRecordId!);
      let response: RelayFetchResponse;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          response = await this.request(`${CODEARCHIVE_API_BASE_URL}/api/v1/relay/captures`, {
            method: "POST",
            // Relay uses only its narrow grant, never the Dashboard session cookie.
            credentials: "omit",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.credential}` },
            body: JSON.stringify({ records: records.map(payload) }),
            signal: controller.signal,
          });
        } finally { clearTimeout(timer); }
      } catch {
        await this.retry(requestAuthority, undefined, true);
        return;
      }
      if (this.blocked) return;
      if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => null);
        await this.invalidate(
          response.status === 401 ? "EXPIRED" : "INVALIDATED",
          { category: response.status === 401 ? "HTTP_401" : "HTTP_403", status: response.status, ...responseMetadata(response, body) },
          requestAuthority,
        );
        return;
      }
      if (response.status === 429 || response.status >= 500) {
        await this.retry(requestAuthority, retryAfterMs(response, this.now()));
        return;
      }
      if (!response.status.toString().startsWith("2")) {
        const body = await response.json().catch(() => null);
        await this.invalidate("INVALIDATED", { category: "HTTP_OTHER", status: response.status, ...responseMetadata(response, body) }, requestAuthority);
        return;
      }
      const body = await response.json().catch(() => null);
      if (!isObject(body) || body.success !== true || !isObject(body.data) || !Array.isArray(body.data.results)) {
        await this.invalidate("INVALIDATED", { category: "MALFORMED_RESPONSE", status: response.status, ...responseMetadata(response, body) }, requestAuthority);
        return;
      }
      const imported: string[] = [];
      const conflicts: string[] = [];
      const seen = new Set<string>();
      for (const result of body.data.results) {
        if (!isObject(result) || typeof result.clientRecordId !== "string" || seen.has(result.clientRecordId)
          || !ids.includes(result.clientRecordId)) {
          await this.invalidate("INVALIDATED", { category: "MALFORMED_RESPONSE", status: response.status, ...responseMetadata(response, body) }, requestAuthority);
          return;
        }
        seen.add(result.clientRecordId);
        if ((result.outcome === "IMPORTED" || result.outcome === "EXISTING") && result.ackEligible === true && result.errorCode === null) imported.push(result.clientRecordId);
        else if (result.outcome === "CONFLICT" && result.ackEligible === false) conflicts.push(result.clientRecordId);
        else {
          await this.invalidate("INVALIDATED", { category: "MALFORMED_RESPONSE", status: response.status, ...responseMetadata(response, body) }, requestAuthority);
          return;
        }
      }
      if (seen.size !== ids.length) {
        await this.invalidate("INVALIDATED", { category: "MALFORMED_RESPONSE", status: response.status, ...responseMetadata(response, body) }, requestAuthority);
        return;
      }
      const at = new Date(this.now()).toISOString();
      if (this.blocked) return;
      if (imported.length && !(await this.markImported(imported, at, requestAuthority))) return;
      if (conflicts.length && !(await this.markConflicts(conflicts, at, requestAuthority, "CLIENT_RECORD_CONFLICT"))) return;
      let resetApplied = false;
      await this.state.update((current) => {
        if (!authorityStillCurrent(current, requestAuthority)) return current;
        resetApplied = true;
        return { ...current, failureCount: 0, nextRetryAt: undefined };
      });
      if (!resetApplied) return;
      if (imported.length || records.length < candidates.length) await this.scheduleIfEligible(0, requestAuthority);
    } finally {
      this.running = false;
    }
  }

  private async retry(authority: RelayAuthoritySnapshot, retryAfter?: number, networkFailure = false): Promise<void> {
    let applied = false;
    const next = await this.state.update((current) => {
      if (!authorityStillCurrent(current, authority)) return current;
      applied = true;
      const delays = networkFailure ? COLD_START_RETRY_DELAYS_MS : RETRY_DELAYS_MS;
      const index = Math.min(Math.max(current.failureCount, 0), delays.length - 1);
      const delay = Math.max(delays[0], delays[index], retryAfter ?? 0);
      return { ...current, failureCount: current.failureCount + 1, nextRetryAt: new Date(this.now() + delay).toISOString() };
    });
    if (applied) await this.scheduleIfEligible(Math.max(0, Date.parse(next.nextRetryAt!) - this.now()), authority);
  }

  private async invalidate(
    state: RelayStateSnapshot["state"],
    failure?: RelayFailureInput,
    authority?: RelayAuthoritySnapshot,
  ): Promise<void> {
    const lastFailure = failure
      ? normalizeRelayFailure({ ...failure, occurredAt: new Date(this.now()).toISOString() })
      : undefined;
    let applied = false;
    await this.state.update((current) => {
      if (authority && !authorityStillCurrent(current, authority)) return current;
      applied = true;
      return {
        ...current,
        state,
        credential: undefined,
        autoSyncEnabled: false,
        signedChallengeId: undefined,
        signedChallengeExpiresAt: undefined,
        provisionedChallengeId: undefined,
        nextRetryAt: undefined,
        ...(lastFailure ? { lastFailure } : {}),
      };
    });
    if (applied || !authority) await this.cancelAlarm(authority);
  }
}

export const backgroundRelayRuntime = new RelayRuntime();
