import { describe, expect, it, vi } from "vitest";
import { clearForeignSyncOwnership } from "./syncOwnership";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

function record(id: string, userKey?: string): SolutionRecord {
  return {
    id,
    platform: "SWEA",
    problemNumber: id,
    title: id,
    language: "Java",
    code: "class Solution {}",
    solvedAt: null,
    aiUsage: "unknown",
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
    ...(userKey ? { sync: { state: "synced" as const, userKey, serverSolutionId: `server-${id}`, lastAttemptAt: "2026-08-26T00:00:00Z", lastSyncedAt: "2026-08-26T00:00:01Z" } } : {}),
  };
}

function repository(records: SolutionRecord[]): SolutionRepository {
  const values = new Map(records.map((item) => [item.id, item]));
  return {
    create: vi.fn(),
    list: vi.fn(async () => [...values.values()]),
    getById: vi.fn(async (id) => values.get(id)),
    update: vi.fn(),
    delete: vi.fn(),
    setSyncMetadata: vi.fn(async (id, sync) => {
      const current = values.get(id)!;
      const updated = { ...current };
      if (sync) updated.sync = sync;
      else delete updated.sync;
      values.set(id, updated);
      return updated;
    }),
  };
}

describe("clearForeignSyncOwnership", () => {
  it("removes stale ownership from another account while preserving current-user and local records", async () => {
    const repo = repository([record("mine", "user-b"), record("stale", "user-a"), record("local")]);
    const result = await clearForeignSyncOwnership(repo, "user-b");

    expect(result.find((item) => item.id === "mine")?.sync?.userKey).toBe("user-b");
    expect(result.find((item) => item.id === "stale")?.sync).toBeUndefined();
    expect(result.find((item) => item.id === "local")?.sync).toBeUndefined();
    expect(repo.setSyncMetadata).toHaveBeenCalledTimes(1);
    expect(repo.setSyncMetadata).toHaveBeenCalledWith("stale", undefined);
  });
});
