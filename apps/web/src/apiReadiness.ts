import { MAIN_API_ORIGIN } from "./authClient";
import { withRequestDeadline } from "./requestDeadline";

// Beta application startup took 122-126s in provider logs, before transport overhead.
export const API_STARTUP_TIMEOUT_MS = 180_000;
export const API_STARTUP_RETRY_MS = 10_000;
export const API_STARTUP_MAX_ATTEMPTS = 18;
export type ReadinessFailure = "network" | "server" | "response";
export type ReadinessResult = { status: "ready" | "cancelled" }
  | { status: "unavailable"; reason: ReadinessFailure };
export type ReadinessCheck = (signal: AbortSignal) => Promise<ReadinessResult>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("cancelled")); return; }
    const finish = () => { signal.removeEventListener("abort", cancel); resolve(); };
    const timer = globalThis.setTimeout(finish, API_STARTUP_RETRY_MS);
    const cancel = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new Error("cancelled"));
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

// Only public, credential-free health reads are retried. Readiness grants no access.
export function createReadinessCheck(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): ReadinessCheck {
  return async (signal) => {
    if (signal.aborted) return { status: "cancelled" };
    let reason: ReadinessFailure = "network";
    try {
      return await withRequestDeadline<ReadinessResult>(async (startupSignal) => {
        for (let attempt = 0; attempt < API_STARTUP_MAX_ATTEMPTS; attempt++) {
          if (startupSignal.aborted) throw new Error("cancelled");
          try {
            const result = await withRequestDeadline(async (requestSignal) => {
              if (requestSignal.aborted) throw new Error("cancelled");
              const response = await fetcher(`${MAIN_API_ORIGIN}/actuator/health`, {
                method: "GET", credentials: "omit", cache: "no-store",
                referrerPolicy: "no-referrer", redirect: "error", signal: requestSignal,
              });
              if (!response.ok) {
                reason = response.status >= 500 ? "server" : "response";
                return response.status >= 500 ? "retry" : "stop";
              }
              let body: unknown;
              try { body = await response.json(); }
              catch { reason = "response"; return "retry"; }
              if (typeof body === "object" && body !== null && "status" in body) {
                if (body.status === "UP") return "ready";
                if (body.status === "DOWN" || body.status === "OUT_OF_SERVICE") {
                  reason = "server";
                  return "retry";
                }
              }
              reason = "response";
              return "retry";
            }, startupSignal);
            if (startupSignal.aborted) throw new Error("cancelled");
            if (result === "ready") return { status: "ready" };
            if (result === "stop") return { status: "unavailable", reason };
          } catch {
            if (startupSignal.aborted) throw new Error("cancelled");
            reason = "network";
          }
          if (attempt + 1 < API_STARTUP_MAX_ATTEMPTS) await pause(startupSignal);
        }
        return { status: "unavailable", reason };
      }, signal, API_STARTUP_TIMEOUT_MS);
    } catch {
      return signal.aborted ? { status: "cancelled" } : { status: "unavailable", reason };
    }
  };
}

export const checkApiReadiness = createReadinessCheck();
