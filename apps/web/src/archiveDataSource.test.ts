import { describe, expect, it, vi } from "vitest";
import { createMainApiArchiveDataSource } from "./archiveDataSource";

const envelope = (data: readonly unknown[]) => ({
  success: true,
  data,
  error: null,
  requestId: "req-archive",
});

describe("Main API archive data source", () => {
  it("loads authenticated solutions and maps them to the archive model", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope([{
      id: "c0f0a2d2-eed4-4786-9a28-6a4fcc3e6505",
      clientRecordId: "local-one",
      platform: "SWEA",
      problemNumber: "1234",
      title: "중위순회",
      language: "JAVA",
      code: "class Solution {}",
      result: "ACCEPTED",
      solvedAt: "2026-08-29T00:00:00Z",
      observedAt: "2026-08-29T00:00:00Z",
      executionTime: null,
      memoryUsage: "32",
      aiUsage: "unknown",
      createdAt: "2026-08-29T00:00:00Z",
      updatedAt: "2026-08-29T00:00:00Z",
    }])), { status: 200, headers: { "Content-Type": "application/json" } }));

    const records = await createMainApiArchiveDataSource(fetcher).listSolutions();

    expect(fetcher).toHaveBeenCalledWith(
      "https://codearchive-api.onrender.com/api/v1/solutions?limit=50",
      { method: "GET", credentials: "include" },
    );
    expect(records).toEqual([{
      id: "c0f0a2d2-eed4-4786-9a28-6a4fcc3e6505",
      platform: "SWEA",
      problemNumber: "1234",
      title: "중위순회",
      language: "JAVA",
      code: "class Solution {}",
      solvedAt: "2026-08-29T00:00:00Z",
      updatedAt: "2026-08-29T00:00:00Z",
      source: "captured",
      memoryUsage: "32",
    }]);
  });

  it("shows an empty archive when signed out", async () => {
    const source = createMainApiArchiveDataSource(async () => new Response("", { status: 401 }));
    await expect(source.listSolutions()).resolves.toEqual([]);
  });

  it("fails closed on malformed success payloads", async () => {
    const source = createMainApiArchiveDataSource(async () => new Response(JSON.stringify(envelope([{ id: "secret-only" }])), { status: 200 }));
    await expect(source.listSolutions()).rejects.toThrow("archive response invalid");
  });
});
