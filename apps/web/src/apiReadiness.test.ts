import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadinessCheck, API_STARTUP_MAX_ATTEMPTS, API_STARTUP_RETRY_MS, API_STARTUP_TIMEOUT_MS } from "./apiReadiness";

const up = () => new Response(JSON.stringify({ status: "UP" }), { status: 200 });
afterEach(() => vi.useRealTimers());

describe("bounded public API startup checks", () => {
  it("sends only a credential-free health GET and does not poll after readiness", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => up());
    const result = await createReadinessCheck(fetcher)(new AbortController().signal);
    expect(result).toEqual({ status: "ready" });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://codearchive-api.onrender.com/actuator/health", {
      method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      redirect: "error", signal: expect.any(AbortSignal),
    });
    await vi.advanceTimersByTimeAsync(API_STARTUP_TIMEOUT_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits between safe health retries and accepts a later healthy response", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockImplementation(async () => up());
    const pending = createReadinessCheck(fetcher)(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(API_STARTUP_RETRY_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["server", () => new Response("", { status: 503 })],
    ["server", () => new Response('{"status":"DOWN"}')],
    ["response", () => new Response("<html>starting</html>")],
    ["response", () => new Response('{"success":true}')],
    ["network", () => { throw new TypeError("sensitive raw error"); }],
  ] as const)("bounds repeated %s failures without exposing raw bodies", async (reason, response) => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response());
    const pending = createReadinessCheck(fetcher)(new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ status: "unavailable", reason });
    expect(fetcher).toHaveBeenCalledTimes(API_STARTUP_MAX_ATTEMPTS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 404, 429])("does not retry HTTP %s or turn it into an authentication result", async (status) => {
    const fetcher = vi.fn(async () => new Response("private body", { status }));
    expect(await createReadinessCheck(fetcher)(new AbortController().signal)).toEqual({ status: "unavailable", reason: "response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["fetch", "body"])("includes stalled %s in the 20 second attempt and 120 second total bounds", async (phase) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal);
      if (phase === "fetch") return new Promise<Response>(() => undefined);
      return { ok: true, json: () => new Promise(() => undefined) } as Response;
    });
    const pending = createReadinessCheck(fetcher)(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signals[0].aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(API_STARTUP_TIMEOUT_MS - 20_000);
    expect(await pending).toEqual({ status: "unavailable", reason: "network" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not begin a request with an already cancelled signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    expect(await createReadinessCheck(fetcher)(controller.signal)).toEqual({ status: "cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["request", "backoff"])("cancels during %s and leaves no scheduled retries", async (phase) => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => phase === "request"
      ? new Promise<Response>(() => undefined) : Promise.resolve(new Response("", { status: 503 })));
    const controller = new AbortController();
    const pending = createReadinessCheck(fetcher)(controller.signal);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    expect(await pending).toEqual({ status: "cancelled" });
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    if (phase === "request") expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("ignores a response arriving after cancellation", async () => {
    let resolve!: (response: Response) => void;
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    const pending = createReadinessCheck(fetcher)(controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: "cancelled" });
    resolve(up());
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
