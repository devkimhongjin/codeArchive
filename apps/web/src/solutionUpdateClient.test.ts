import { describe, expect, it, vi } from "vitest";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import { createMainApiSolutionUpdateClient, type DashboardSolutionEditInput } from "./solutionUpdateClient";

const original: DashboardServerSolution = {
  id: "server-1",
  clientRecordId: "capture/with spaces",
  platform: "SWEA",
  problemNumber: "1206",
  title: "View",
  language: "JAVA",
  code: "class Main {}",
  result: "ACCEPTED",
  solvedAt: "2026-08-30T01:00:00Z",
  observedAt: "2026-08-30T01:00:01Z",
  executionTime: "100",
  memoryUsage: "200",
  aiUsage: "unknown",
  createdAt: "2026-08-30T01:00:02Z",
  updatedAt: "2026-08-30T01:00:03Z",
  source: "captured",
};

const input: DashboardSolutionEditInput = {
  platform: "SWEA",
  problemNumber: "1206",
  title: "View updated",
  language: "JAVA",
  code: "class Main { int x; }",
  executionTime: "111",
  memoryUsage: "222",
  aiUsage: "not_used",
};

function responseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: original.id,
    clientRecordId: original.clientRecordId,
    platform: input.platform,
    problemNumber: input.problemNumber,
    title: input.title,
    language: input.language,
    code: input.code,
    result: original.result,
    solvedAt: original.solvedAt,
    observedAt: original.observedAt,
    executionTime: input.executionTime,
    memoryUsage: input.memoryUsage,
    aiUsage: input.aiUsage,
    createdAt: original.createdAt,
    updatedAt: "2026-08-30T02:00:00Z",
    ...overrides,
  };
}

function envelope(data: unknown) {
  return { success: true, data, error: null, requestId: "req-edit" };
}

describe("Main API solution update client", () => {
  it("uses the exact encoded clientRecordId, authenticated cookie request, and no ownership field", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify(envelope(responseRecord())),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const updated = await createMainApiSolutionUpdateClient(fetcher).updateSolution(original, input);

    expect(updated.title).toBe("View updated");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://codearchive-api.onrender.com/api/v1/solutions/by-client-id/capture%2Fwith%20spaces");
    expect(init).toEqual(expect.objectContaining({
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: expect.any(AbortSignal),
    }));

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      platform: "SWEA",
      problemNumber: "1206",
      title: "View updated",
      language: "JAVA",
      code: "class Main { int x; }",
      result: "ACCEPTED",
      solvedAt: "2026-08-30T01:00:00Z",
      observedAt: "2026-08-30T01:00:01Z",
      executionTime: "111",
      memoryUsage: "222",
      aiUsage: "not_used",
    });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("account");
    expect(body).not.toHaveProperty("githubLogin");
    expect(body).not.toHaveProperty("clientRecordId");
  });

  it("maps blank optional performance values to null without changing capture semantics", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify(envelope(responseRecord({ executionTime: null, memoryUsage: null }))),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await createMainApiSolutionUpdateClient(fetcher).updateSolution(original, {
      ...input,
      executionTime: " ",
      memoryUsage: "",
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.executionTime).toBeNull();
    expect(body.memoryUsage).toBeNull();
    expect(body.result).toBe(original.result);
    expect(body.observedAt).toBe(original.observedAt);
  });

  it("surfaces 401 as the existing Dashboard session-expiry signal", async () => {
    const client = createMainApiSolutionUpdateClient(async () => new Response("", { status: 401 }));
    await expect(client.updateSolution(original, input)).rejects.toBeInstanceOf(ArchiveSessionExpiredError);
  });

  it("rejects non-success responses", async () => {
    const client = createMainApiSolutionUpdateClient(async () => new Response("{}", { status: 500 }));
    await expect(client.updateSolution(original, input)).rejects.toThrow("solution update failed");
  });

  it("fails closed on malformed or mismatched success responses", async () => {
    const malformed = createMainApiSolutionUpdateClient(async () => new Response(
      JSON.stringify(envelope({ id: "only-id" })),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await expect(malformed.updateSolution(original, input)).rejects.toThrow("solution update response invalid");

    const mismatched = createMainApiSolutionUpdateClient(async () => new Response(
      JSON.stringify(envelope(responseRecord({ clientRecordId: "other" }))),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await expect(mismatched.updateSolution(original, input)).rejects.toThrow("solution update response invalid");
  });
});