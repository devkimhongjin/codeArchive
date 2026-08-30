export const API_REQUEST_TIMEOUT_MS = 20_000;

// Include body decoding in the deadline, not just response headers.
export async function withRequestDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = API_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let cancel: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error("request unavailable"));
    };
  });
  const timer = globalThis.setTimeout(cancel, timeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) cancel();
    return await Promise.race([aborted, operation(controller.signal)]);
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
