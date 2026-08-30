import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardAuthClient } from "./authClient";
import { createMainApiArchiveDataSource } from "./archiveDataSource";
import { API_REQUEST_TIMEOUT_MS } from "./requestDeadline";

afterEach(() => vi.useRealTimers());

describe("API request deadlines", () => {
  it.each(["headers", "body"])("bounds stalled %s and allows a fresh auth/archive retry", async (stage) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      signals.push(init!.signal as AbortSignal);
      return stage === "headers" ? new Promise(() => undefined)
        : Promise.resolve({ status: 200, ok: true, json: () => new Promise(() => undefined) } as Response);
    });
    const auth = createDashboardAuthClient(fetcher);
    const archive = createMainApiArchiveDataSource(fetcher);
    const authResult = auth.discoverSession();
    const archiveResult = expect(archive.listSolutions()).rejects.toThrow("request unavailable");
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    expect(await authResult).toEqual({ status: "unavailable" });
    await archiveResult;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    fetcher.mockImplementationOnce(async () => new Response(null, { status: 401 }));
    expect(await auth.discoverSession()).toEqual({ status: "signed_out" });
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ success: true, data: [] })));
    expect(await archive.listSolutions()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stale caller request and disposes its deadline", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const auth = createDashboardAuthClient(() => new Promise(() => undefined));
    const result = auth.discoverSession(abort.signal);
    abort.abort();
    expect(await result).toEqual({ status: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
