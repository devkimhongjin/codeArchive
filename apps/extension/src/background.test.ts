import { describe, expect, it, vi } from "vitest";
import type { SolutionRecord, SolutionSyncMetadata } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

function setupChrome(): void {
  (globalThis as any).chrome = { runtime: { onMessage: { addListener: () => undefined } } };
}

const record: SolutionRecord = {
  id: "swea-auto:capture-1", platform: "SWEA", problemNumber: "1234", title: "Test", language: "Java", code: "class Solution {}",
  solvedAt: "2026-08-25", aiUsage: "unknown", createdAt: "2026-08-25T06:00:00Z", updatedAt: "2026-08-25T06:00:00Z",
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-25T06:01:00Z" },
};

const capture = {
  captureId: "capture-1", platform: "SWEA" as const, result: "ACCEPTED" as const, problemNumber: "1234", title: "Test", language: "Java",
  code: "class Solution {}", observedAt: "2026-08-25T06:01:00Z", solvedAt: "2026-08-25",
};

function repository(): SolutionRepository {
  return {
    create: vi.fn(), list: vi.fn(async () => [record]), getById: vi.fn(async () => record), update: vi.fn(), delete: vi.fn(),
    setSyncMetadata: vi.fn(async (_id: string, sync: SolutionSyncMetadata) => ({ ...record, sync })),
  };
}

describe("background capture validation", () => {
  it("rejects malformed capture payloads before persistence", async () => {
    setupChrome();
    const { valid } = await import("./background");
    expect(valid({})).toBe(false);
    expect(valid({ captureId: "x", platform: "SWEA", result: "ACCEPTED" })).toBe(false);
  });

  it("completes the local commit before any auth or network sync attempt", async () => {
    setupChrome();
    const { saveThenSyncAcceptedCapture } = await import("./background");
    const order: string[] = [];

    const response = await saveThenSyncAcceptedCapture(capture, {
      saveCapture: vi.fn(async () => { order.push("local-commit"); return { status: "saved" as const, solutionId: record.id, savedAt: record.createdAt }; }),
      sync: {
        repository: repository(),
        authProvider: { getAuthenticatedSession: vi.fn(async () => { order.push("auth"); return null; }) },
        now: () => "2026-08-25T07:00:00Z",
      },
    });

    expect(response.status).toBe("saved");
    expect(order[0]).toBe("local-commit");
  });

  it("acknowledges the local save while sync is still pending and ignores later sync failure", async () => {
    setupChrome();
    const { saveThenSyncAcceptedCapture } = await import("./background");
    let rejectAuth!: (reason?: unknown) => void;
    const pendingAuth = new Promise<never>((_resolve, reject) => { rejectAuth = reject; });

    const acknowledgement = saveThenSyncAcceptedCapture(capture, {
      saveCapture: vi.fn(async () => ({ status: "saved" as const, solutionId: record.id, savedAt: record.createdAt })),
      sync: {
        repository: repository(),
        authProvider: { getAuthenticatedSession: vi.fn(() => pendingAuth) },
        now: () => "2026-08-25T07:00:00Z",
      },
    });

    await expect(acknowledgement).resolves.toEqual({ status: "saved", solutionId: record.id, savedAt: record.createdAt });

    rejectAuth(new Error("backend unavailable"));
    await Promise.resolve();
    await Promise.resolve();

    await expect(acknowledgement).resolves.toEqual({ status: "saved", solutionId: record.id, savedAt: record.createdAt });
  });

  it("returns only the persisted auth view state from a successful background login", async () => {
    setupChrome();
    const { runBackgroundLogin } = await import("./background");
    const state = {
      status: "authenticated" as const,
      user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null },
      expiresAt: "2026-08-27T00:00:00Z",
    };

    await expect(runBackgroundLogin({ login: vi.fn(async () => state) } as any)).resolves.toEqual({ ok: true, state });
  });

  it("collapses background OAuth failures to a generic non-sensitive category", async () => {
    setupChrome();
    const { runBackgroundLogin } = await import("./background");
    const sensitiveFailure = new Error("state=secret&code=secret-token https://github.com/login/oauth/authorize");

    const response = await runBackgroundLogin({ login: vi.fn(async () => { throw sensitiveFailure; }) } as any);
    expect(response).toEqual({ ok: false, error: "auth_failed" });
    expect(JSON.stringify(response)).not.toMatch(/state=|code=|token|github\.com\/login/i);
  });
});
