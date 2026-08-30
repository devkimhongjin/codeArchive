import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { API_REQUEST_TIMEOUT_MS } from "./requestDeadline";
import { createMainApiSolutionDeleteClient } from "./solutionDeleteClient";

const id = "11111111-1111-4111-8111-111111111111";
const envelope = { success: true, data: { deleted: true }, error: null, requestId: "synthetic-delete" };
const response = (value: unknown = envelope) => new Response(JSON.stringify(value), { status: 200 });

afterEach(() => vi.useRealTimers());

describe("Main API solution delete client", () => {
  it("deletes only the server UUID using the authenticated API origin without a body or ownership fields", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response());
    await expect(createMainApiSolutionDeleteClient(fetcher).deleteSolution(id)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://codearchive-api.onrender.com/api/v1/solutions/${id}`,
      { method: "DELETE", credentials: "include", signal: expect.any(AbortSignal) },
    );
  });

  it.each(["capture-1", "../other", "", "https://other.invalid", `${id}/child`])("rejects invalid server identifier %s before any request", async (invalid) => {
    const fetcher = vi.fn();
    await expect(createMainApiSolutionDeleteClient(fetcher).deleteSolution(invalid)).rejects.toThrow("id invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("routes 401 through the existing session-expiry signal", async () => {
    const client = createMainApiSolutionDeleteClient(async () => new Response("", { status: 401 }));
    await expect(client.deleteSolution(id)).rejects.toBeInstanceOf(ArchiveSessionExpiredError);
  });

  it.each([403, 404, 500])("does not treat HTTP %s as deletion or retry it", async (status) => {
    const fetcher = vi.fn(async () => new Response("private server error", { status }));
    await expect(createMainApiSolutionDeleteClient(fetcher).deleteSolution(id)).rejects.toThrow("solution delete failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { ...envelope, success: false },
    { ...envelope, error: {} },
    { ...envelope, requestId: " " },
    { ...envelope, data: { deleted: false } },
    { ...envelope, data: { deleted: "true" } },
    { ...envelope, data: null },
  ])("fails closed on malformed success: %j", async (value) => {
    await expect(createMainApiSolutionDeleteClient(async () => response(value)).deleteSolution(id)).rejects.toThrow("response invalid");
  });

  it("rejects a non-JSON successful response", async () => {
    await expect(createMainApiSolutionDeleteClient(async () => new Response("not json")).deleteSolution(id)).rejects.toThrow();
  });

  it("does not dispatch an already cancelled deletion", async () => {
    const fetcher = vi.fn();
    const abort = new AbortController();
    abort.abort();
    await expect(createMainApiSolutionDeleteClient(fetcher).deleteSolution(id, abort.signal)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels an in-flight request without retrying", async () => {
    const abort = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const pending = createMainApiSolutionDeleteClient(fetcher).deleteSolution(id, abort.signal);
    const rejected = expect(pending).rejects.toThrow("request unavailable");
    abort.abort();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled response body and aborts the request", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      const result = response();
      result.json = () => new Promise(() => undefined);
      return result;
    });
    const pending = createMainApiSolutionDeleteClient(fetcher).deleteSolution(id);
    const rejected = expect(pending).rejects.toThrow("request unavailable");
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
