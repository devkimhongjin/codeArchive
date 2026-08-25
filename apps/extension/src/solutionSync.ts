import type { AiUsage, SolutionRecord, SolutionSyncMetadata } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

export interface AuthenticatedCodeArchiveSession {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface CodeArchiveAuthProvider {
  getAuthenticatedSession(): Promise<AuthenticatedCodeArchiveSession | null>;
}

export interface SyncPayload {
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  result: "ACCEPTED";
  solvedAt: string | null;
  observedAt: string;
  executionTime: string | null;
  memoryUsage: string | null;
  aiUsage: AiUsage;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
}

interface MeResponse {
  id: string;
}

interface SolutionResponse {
  id: string;
}

export interface CodeArchiveSyncApi {
  resolveUserKey(session: AuthenticatedCodeArchiveSession): Promise<string>;
  upsertSolution(session: AuthenticatedCodeArchiveSession, clientRecordId: string, payload: SyncPayload): Promise<{ serverSolutionId: string }>;
}

async function parseSuccess<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("CodeArchive API request failed.");
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!envelope.success || !envelope.data) throw new Error("CodeArchive API response failed.");
  return envelope.data;
}

export const codeArchiveSyncApi: CodeArchiveSyncApi = {
  async resolveUserKey(session) {
    const data = await parseSuccess<MeResponse>(await session.request("/api/v1/me", { method: "GET" }));
    if (!data.id) throw new Error("CodeArchive user identity is missing.");
    return data.id;
  },

  async upsertSolution(session, clientRecordId, payload) {
    const data = await parseSuccess<SolutionResponse>(await session.request(
      `/api/v1/solutions/by-client-id/${encodeURIComponent(clientRecordId)}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    ));
    if (!data.id) throw new Error("CodeArchive solution identity is missing.");
    return { serverSolutionId: data.id };
  },
};

export const unauthenticatedAuthProvider: CodeArchiveAuthProvider = {
  async getAuthenticatedSession() { return null; },
};

function solvedAtInstant(solvedAt: string | null): string | null {
  if (!solvedAt) return null;
  const instant = new Date(`${solvedAt}T00:00:00+09:00`);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export function buildSyncPayload(record: SolutionRecord): SyncPayload | null {
  if (record.platform !== "SWEA" || record.autoCapture?.result !== "ACCEPTED") return null;
  return {
    platform: record.platform,
    problemNumber: record.problemNumber,
    title: record.title,
    language: record.language,
    code: record.code,
    result: "ACCEPTED",
    solvedAt: solvedAtInstant(record.solvedAt),
    observedAt: record.autoCapture.observedAt,
    executionTime: record.performance?.executionTime ?? null,
    memoryUsage: record.performance?.memoryUsage ?? null,
    aiUsage: record.aiUsage,
  };
}

export interface SolutionSyncDependencies {
  repository: SolutionRepository;
  authProvider: CodeArchiveAuthProvider;
  api?: CodeArchiveSyncApi;
  now?: () => string;
}

async function persistRetryable(repository: SolutionRepository, record: SolutionRecord, attemptedAt: string, userKey?: string): Promise<SolutionSyncMetadata> {
  const sync: SolutionSyncMetadata = { state: "retryable", lastAttemptAt: attemptedAt, ...(userKey ? { userKey } : {}) };
  await repository.setSyncMetadata(record.id, sync);
  return sync;
}

export async function syncSolutionRecord(recordId: string, dependencies: SolutionSyncDependencies): Promise<SolutionSyncMetadata | null> {
  const api = dependencies.api ?? codeArchiveSyncApi;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const record = await dependencies.repository.getById(recordId);
  if (!record) return null;
  const payload = buildSyncPayload(record);
  if (!payload) return null;

  const attemptedAt = now();
  let session: AuthenticatedCodeArchiveSession | null;
  try {
    session = await dependencies.authProvider.getAuthenticatedSession();
  } catch {
    return persistRetryable(dependencies.repository, record, attemptedAt);
  }
  if (!session) return persistRetryable(dependencies.repository, record, attemptedAt);

  let userKey: string;
  try {
    userKey = await api.resolveUserKey(session);
  } catch {
    return persistRetryable(dependencies.repository, record, attemptedAt);
  }

  try {
    const result = await api.upsertSolution(session, record.id, payload);
    const syncedAt = now();
    const sync: SolutionSyncMetadata = {
      state: "synced",
      userKey,
      serverSolutionId: result.serverSolutionId,
      lastAttemptAt: attemptedAt,
      lastSyncedAt: syncedAt,
    };
    await dependencies.repository.setSyncMetadata(record.id, sync);
    return sync;
  } catch {
    return persistRetryable(dependencies.repository, record, attemptedAt, userKey);
  }
}
