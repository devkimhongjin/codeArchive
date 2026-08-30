import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { API_REQUEST_TIMEOUT_MS } from "./requestDeadline";
import { AI_CREATE_TIMEOUT_MS, AiArtifactRequestError, createMainApiAiArtifactClient, type AiTaskType } from "./aiArtifactClient";

const id = "11111111-1111-4111-8111-111111111111";
const record = { id: "22222222-2222-4222-8222-222222222222", solutionId: id, type: "CODE_REVIEW", content: "synthetic review", provider: "fake", model: "fake-model", createdAt: "2026-08-31T00:00:00Z" };
const envelope = (data: unknown) => ({ success: true, error: null, requestId: "synthetic", data });
const response = (data: unknown) => new Response(JSON.stringify(envelope(data)));
afterEach(() => vi.useRealTimers());

describe("Dashboard AI API contract", () => {
  it.each<AiTaskType>(["APPROACH_DESIGN", "COMMENTED_CODE", "CODE_REVIEW"])("creates %s with only type and session cookies", async (type) => {
    const fetcher = vi.fn(async () => response({ ...record, type }));
    expect(await createMainApiAiArtifactClient(fetcher).create(id, type)).toEqual({ ...record, type });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`https://codearchive-api.onrender.com/api/v1/solutions/${id}/ai-artifacts`, {
      method: "POST", credentials: "include", signal: expect.any(AbortSignal), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }),
    });
  });
  it("lists existing artifacts without a request body", async () => {
    const fetcher = vi.fn(async () => response([record]));
    expect(await createMainApiAiArtifactClient(fetcher).list(id)).toEqual([record]);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`https://codearchive-api.onrender.com/api/v1/solutions/${id}/ai-artifacts`, { method: "GET", credentials: "include", signal: expect.any(AbortSignal) });
  });
  it.each(["capture-1", "../other", "", `${id}/child`])("rejects identifier %s before transmission", async (invalid) => {
    const fetcher = vi.fn();
    const client = createMainApiAiArtifactClient(fetcher);
    await expect(client.create(invalid, "CODE_REVIEW")).rejects.toThrow();
    await expect(client.list(invalid)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["toString", "constructor", "__proto__", "OTHER"])("rejects unsupported task %s before transmission", async (invalid) => {
    const fetcher = vi.fn();
    await expect(createMainApiAiArtifactClient(fetcher).create(id, invalid as AiTaskType)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 429, 500, 502])("safely rejects HTTP %s without retry or server error disclosure", async (status) => {
    const fetcher = vi.fn(async () => new Response("private backend details", { status }));
    const result = createMainApiAiArtifactClient(fetcher).create(id, "CODE_REVIEW");
    await expect(result).rejects.toBeInstanceOf(status === 401 ? ArchiveSessionExpiredError : AiArtifactRequestError);
    if (status === 429) await expect(result).rejects.toHaveProperty("kind", "rate_limit");
    await expect(result).rejects.not.toThrow("private backend");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    null, { ...envelope(record), success: false }, { ...envelope(record), error: {} }, { ...envelope(record), requestId: " " },
    envelope({ ...record, id: "capture" }), envelope({ ...record, solutionId: "other" }), envelope({ ...record, type: "COMMENTED_CODE" }),
    envelope({ ...record, content: " " }), envelope({ ...record, provider: null }), envelope({ ...record, model: 5 }), envelope({ ...record, createdAt: "invalid" }),
  ])("rejects malformed or misbound creation response %#", async (value) => {
    await expect(createMainApiAiArtifactClient(async () => new Response(JSON.stringify(value))).create(id, "CODE_REVIEW")).rejects.toThrow();
  });
  it.each([{}, [record, record], [{ ...record, solutionId: "other" }], [{ ...record, type: "toString" }]])("rejects malformed artifact collections %#", async (data) => {
    await expect(createMainApiAiArtifactClient(async () => response(data)).list(id)).rejects.toThrow();
  });
  it("does not dispatch an already aborted request", async () => {
    const fetcher = vi.fn();
    const abort = new AbortController(); abort.abort();
    await expect(createMainApiAiArtifactClient(fetcher).create(id, "CODE_REVIEW", abort.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts in-flight generation without retry", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); });
    const abort = new AbortController();
    const rejected = expect(createMainApiAiArtifactClient(fetcher).create(id, "CODE_REVIEW", abort.signal)).rejects.toThrow();
    abort.abort(); await rejected;
    expect(signal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["list", "create"] as const)("bounds stalled %s response bodies with the appropriate deadline", async (operation) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      const result = response(record); result.json = () => new Promise(() => {}); return result;
    });
    const client = createMainApiAiArtifactClient(fetcher);
    const pending = operation === "create" ? client.create(id, "CODE_REVIEW") : client.list(id);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    if (operation === "create") {
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(AI_CREATE_TIMEOUT_MS - API_REQUEST_TIMEOUT_MS);
    }
    await rejected; expect(signal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
