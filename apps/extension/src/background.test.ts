import { describe, expect, it, vi } from "vitest";
import type { SolutionRecord, SolutionSyncMetadata } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

describe("background capture validation", () => {
  it("rejects malformed capture payloads before persistence", async () => {
    const chrome = { runtime: { onMessage: { addListener: () => undefined } } }; (globalThis as any).chrome = chrome;
    const { valid } = await import("./background");
    expect(valid({})).toBe(false);
    expect(valid({ captureId: "x", platform: "SWEA", result: "ACCEPTED" })).toBe(false);
  });

  it("completes the local commit before any auth or network sync attempt", async () => {
    const chrome = { runtime: { onMessage: { addListener: () => undefined } } }; (globalThis as any).chrome = chrome;
    const { saveThenSyncAcceptedCapture } = await import("./background");
    const order: string[] = [];
    const record: SolutionRecord = {
      id: "swea-auto:capture-1", platform: "SWEA", problemNumber: "1234", title: "Test", language: "Java", code: "class Solution {}",
      solvedAt: "2026-08-25", aiUsage: "unknown", createdAt: "2026-08-25T06:00:00Z", updatedAt: "2026-08-25T06:00:00Z",
      autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-25T06:01:00Z" },
    };
    const repository: SolutionRepository = {
      create: vi.fn(), list: vi.fn(async () => [record]), getById: vi.fn(async () => record), update: vi.fn(), delete: vi.fn(),
      setSyncMetadata: vi.fn(async (_id: string, sync: SolutionSyncMetadata) => ({ ...record, sync })),
    };
    const capture = {
      captureId: "capture-1", platform: "SWEA" as const, result: "ACCEPTED" as const, problemNumber: "1234", title: "Test", language: "Java",
      code: "class Solution {}", observedAt: "2026-08-25T06:01:00Z", solvedAt: "2026-08-25",
    };

    const response = await saveThenSyncAcceptedCapture(capture, {
      saveCapture: vi.fn(async () => { order.push("local-commit"); return { status: "saved" as const, solutionId: record.id, savedAt: record.createdAt }; }),
      sync: {
        repository,
        authProvider: { getAuthenticatedSession: vi.fn(async () => { order.push("auth"); return null; }) },
        now: () => "2026-08-25T07:00:00Z",
      },
    });

    expect(response.status).toBe("saved");
    expect(order).toEqual(["local-commit", "auth"]);
  });
});
