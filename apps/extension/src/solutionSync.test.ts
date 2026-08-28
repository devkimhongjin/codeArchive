import { describe, expect, it, vi } from "vitest";
import type { SolutionRecord, SolutionSyncMetadata } from "./solution";
import type { SolutionRepository } from "./solutionRepository";
import { buildSyncPayload, syncSolutionRecord, type AuthenticatedCodeArchiveSession, type CodeArchiveSyncApi } from "./solutionSync";

const baseRecord: SolutionRecord = {
  id: "swea-auto:capture-1",
  platform: "SWEA",
  problemNumber: "1234",
  title: "Test",
  language: "Java",
  code: "class Solution {}",
  solvedAt: "2026-08-25",
  aiUsage: "unknown",
  createdAt: "2026-08-25T06:00:00.000Z",
  updatedAt: "2026-08-25T06:00:00.000Z",
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-25T06:01:00.000Z" },
};

function repository(initial: SolutionRecord): SolutionRepository & { current(): SolutionRecord } {
  let record = structuredClone(initial);
  return {
    create: vi.fn(),
    list: vi.fn(async () => [record]),
    getById: vi.fn(async (id) => id === record.id ? record : undefined),
    update: vi.fn(),
    delete: vi.fn(),
    setSyncMetadata: vi.fn(async (id: string, sync: SolutionSyncMetadata) => {
      if (id !== record.id) throw new Error("not found");
      record = { ...record, sync };
      return record;
    }),
    current: () => record,
  };
}

const session: AuthenticatedCodeArchiveSession = { request: vi.fn() };

function api(userKey = "user-a", upsert = vi.fn(async () => ({ serverSolutionId: "server-1" }))): CodeArchiveSyncApi {
  return {
    resolveUserKey: vi.fn(async () => userKey),
    upsertSolution: upsert,
  };
}

describe("solution authenticated sync", () => {
  it("builds only the #33 payload fields and preserves nullable performance plus aiUsage", () => {
    const payload = buildSyncPayload({ ...baseRecord, aiUsage: "used" });
    expect(payload).toEqual({
      platform: "SWEA",
      problemNumber: "1234",
      title: "Test",
      language: "Java",
      code: "class Solution {}",
      result: "ACCEPTED",
      solvedAt: "2026-08-24T15:00:00.000Z",
      observedAt: "2026-08-25T06:01:00.000Z",
      executionTime: null,
      memoryUsage: null,
      aiUsage: "used",
    });
    expect(Object.keys(payload ?? {})).not.toEqual(expect.arrayContaining([
      "userId", "userKey", "contestProbId", "token", "cookie", "problemBody", "sample",
    ]));

    const withPerformance = buildSyncPayload({ ...baseRecord, performance: { executionTime: "81 ms", memoryUsage: "32 MB" }, aiUsage: "not_used" });
    expect(withPerformance?.executionTime).toBe("81 ms");
    expect(withPerformance?.memoryUsage).toBe("32 MB");
    expect(withPerformance?.aiUsage).toBe("not_used");
  });

  it("syncs authenticated user A and stores CodeArchive user id as userKey", async () => {
    const repo = repository(baseRecord);
    const client = api("user-a");
    const result = await syncSolutionRecord(baseRecord.id, {
      repository: repo,
      authProvider: { getAuthenticatedSession: vi.fn(async () => session) },
      api: client,
      now: (() => { const values = ["2026-08-25T07:00:00.000Z", "2026-08-25T07:00:01.000Z"]; return () => values.shift()!; })(),
    });

    expect(client.upsertSolution).toHaveBeenCalledWith(session, baseRecord.id, expect.objectContaining({ result: "ACCEPTED" }));
    expect(result).toEqual({
      state: "synced",
      userKey: "user-a",
      serverSolutionId: "server-1",
      lastAttemptAt: "2026-08-25T07:00:00.000Z",
      lastSyncedAt: "2026-08-25T07:00:01.000Z",
    });
    expect(repo.current().updatedAt).toBe(baseRecord.updatedAt);
  });

  it("keeps the local record and marks retryable when unauthenticated or network fails", async () => {
    const unauthRepo = repository(baseRecord);
    await syncSolutionRecord(baseRecord.id, {
      repository: unauthRepo,
      authProvider: { getAuthenticatedSession: vi.fn(async () => null) },
      api: api(),
      now: () => "2026-08-25T07:00:00.000Z",
    });
    expect(unauthRepo.current().code).toBe(baseRecord.code);
    expect(unauthRepo.current().sync).toEqual({ state: "retryable", lastAttemptAt: "2026-08-25T07:00:00.000Z" });

    const networkRepo = repository(baseRecord);
    const failingApi: CodeArchiveSyncApi = {
      resolveUserKey: vi.fn(async () => "user-a"),
      upsertSolution: vi.fn(async () => { throw new Error("offline"); }),
    };
    await syncSolutionRecord(baseRecord.id, {
      repository: networkRepo,
      authProvider: { getAuthenticatedSession: vi.fn(async () => session) },
      api: failingApi,
      now: () => "2026-08-25T07:01:00.000Z",
    });
    expect(networkRepo.current().code).toBe(baseRecord.code);
    expect(networkRepo.current().sync).toEqual({ state: "retryable", userKey: "user-a", lastAttemptAt: "2026-08-25T07:01:00.000Z" });
  });

  it("retries with the same clientRecordId and relies on server idempotency", async () => {
    const repo = repository({ ...baseRecord, sync: { state: "retryable", userKey: "user-a", lastAttemptAt: "2026-08-25T06:30:00.000Z" } });
    const upsert = vi.fn(async () => ({ serverSolutionId: "server-1" }));
    const client = api("user-a", upsert);
    const deps = {
      repository: repo,
      authProvider: { getAuthenticatedSession: vi.fn(async () => session) },
      api: client,
      now: () => "2026-08-25T07:00:00.000Z",
    };
    await syncSolutionRecord(baseRecord.id, deps);
    await syncSolutionRecord(baseRecord.id, deps);
    expect(upsert).toHaveBeenCalledTimes(2);
    const calls = upsert.mock.calls as unknown as Array<[AuthenticatedCodeArchiveSession, string, unknown]>;
    expect(calls.map((call) => call[1])).toEqual([baseRecord.id, baseRecord.id]);
  });

  it("does not reuse user A synced ownership when the current user changes to B", async () => {
    const repo = repository({
      ...baseRecord,
      sync: { state: "synced", userKey: "user-a", serverSolutionId: "server-a", lastAttemptAt: "2026-08-25T06:00:00.000Z", lastSyncedAt: "2026-08-25T06:00:01.000Z" },
    });
    const upsert = vi.fn(async () => ({ serverSolutionId: "server-b" }));
    await syncSolutionRecord(baseRecord.id, {
      repository: repo,
      authProvider: { getAuthenticatedSession: vi.fn(async () => session) },
      api: api("user-b", upsert),
      now: () => "2026-08-25T07:00:00.000Z",
    });
    expect(upsert).toHaveBeenCalledOnce();
    expect(repo.current().sync?.userKey).toBe("user-b");
    expect(repo.current().sync?.serverSolutionId).toBe("server-b");
  });
});
