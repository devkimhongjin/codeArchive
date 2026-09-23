import { createAdapter } from "./adapters";
import { collectAcceptedCaptureAttempt } from "./capture";
import type { Capture, PlatformAdapter } from "./types";
import {
  createSweaProblemContext,
  normalizeSweaDetailUrl,
  resolveSweaProblem,
  SWEA_CONTEXT_LOOKUP_ERROR,
  type SweaProblemContext
} from "./sweaProblemContext";
import {
  SWEA_ORIGIN,
  SWEA_PROBLEM_DETAIL_PATHS,
  SWEA_SOLVING_PATH,
  SWEA_USER_SUBMISSIONS_PATH
} from "./adapters/sweaSelectors";

const STORE_CAPTURE_RETRY_DELAYS_MS = [50, 150, 500] as const;

type SendRuntimeMessage = (message: unknown) => Promise<unknown>;
type Sleep = (delayMs: number) => Promise<void>;

export async function storeSweaProblemContext(
  document: Document,
  location: Location,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message),
  observedAt = Date.now()
): Promise<boolean> {
  const context = createSweaProblemContext(document, location, observedAt);
  if (!context) return false;
  try {
    const response = await send({ type: "STORE_SWEA_PROBLEM_CONTEXT", context });
    return (response as { ok?: unknown } | null)?.ok === true;
  } catch {
    return false;
  }
}

export async function loadSweaProblemContext(
  sourceUrl: string,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message)
): Promise<SweaProblemContext | null | typeof SWEA_CONTEXT_LOOKUP_ERROR> {
  try {
    const response = await send({ type: "GET_SWEA_PROBLEM_CONTEXT", sourceUrl });
    const result = response as { context?: unknown; missing?: unknown; error?: unknown } | null;
    if (!result || result.error !== undefined) return SWEA_CONTEXT_LOOKUP_ERROR;
    const context = result.context;
    if (context === null && result.missing === true) return null;
    return context && typeof context === "object" ? context as SweaProblemContext : SWEA_CONTEXT_LOOKUP_ERROR;
  } catch {
    return SWEA_CONTEXT_LOOKUP_ERROR;
  }
}

/**
 * SWEA can POST from My Page into a query-less detail page and then into a
 * query-less solving page. Those exact same-origin routes are navigation
 * context, not failed canonical-detail lookups. Keep malformed, cross-origin,
 * or contestProbId-bearing conflicts fail-closed while allowing the solving
 * page's own unambiguous DOM identity to be used.
 */
export async function loadSweaProblemContextForReferrer(
  referrer: string,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message)
): Promise<SweaProblemContext | null | typeof SWEA_CONTEXT_LOOKUP_ERROR> {
  if (!referrer) return null;
  const detailUrl = normalizeSweaDetailUrl(referrer);
  if (detailUrl) return loadSweaProblemContext(detailUrl, send);
  try {
    const url = new URL(referrer);
    const isQuerylessNavigationRoute = url.searchParams.getAll("contestProbId").length === 0 && (
      url.pathname === SWEA_USER_SUBMISSIONS_PATH ||
      url.pathname === SWEA_SOLVING_PATH ||
      SWEA_PROBLEM_DETAIL_PATHS.some((path) => path === url.pathname)
    );
    if (url.origin === SWEA_ORIGIN && isQuerylessNavigationRoute) return null;
  } catch {
    // An invalid non-empty referrer is conflict evidence, not missing context.
  }
  return SWEA_CONTEXT_LOOKUP_ERROR;
}

/**
 * The service worker can be starting up when the result popup first appears.
 * Keep the same attempt payload and retry a small, bounded number of times;
 * callers consume the attempt only after an explicit positive response.
 */
export async function storeCaptureWithRetry(
  capture: Capture,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message),
  sleep: Sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
): Promise<unknown> {
  let response: unknown;
  for (let attempt = 0; attempt <= STORE_CAPTURE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await send({ type: "STORE_CAPTURE", capture });
      if ((response as { ok?: unknown } | null)?.ok === true) return response;
    } catch {
      response = undefined;
    }

    const delay = STORE_CAPTURE_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }
  return response;
}

export function startCapture(adapter: PlatformAdapter, document: Document, send: SendRuntimeMessage): void {
  let processing = false;
  let checkScheduled = false;
  let checkAfterProcessing = false;
  let resultPoll: ReturnType<typeof setInterval> | null = null;
  let activeAttemptId: string | null = null;

  function reportProgress(attemptId: string | null, phase: "CAPTURING" | "SAVING" | "CLEAR"): void {
    if (!attemptId) return;
    const problem = adapter.detectProblem();
    if (phase === "CAPTURING" && !problem) return;
    void send({
      type: "SET_SUBMISSION_PROGRESS", attemptId, platform: adapter.platform, phase,
      ...(problem ? { problemNumber: problem.problemNumber, title: problem.title } : {})
    }).catch(() => undefined);
  }

  function ensureResultPoll(): void {
    if (!adapter.hasPendingSubmissionAttempt || resultPoll !== null) return;
    resultPoll = setInterval(() => {
      if (!adapter.hasPendingSubmissionAttempt?.()) {
        clearInterval(resultPoll!);
        resultPoll = null;
        reportProgress(activeAttemptId, "CLEAR");
        activeAttemptId = null;
        return;
      }
      scheduleCaptureCheck();
    }, 300);
  }

  const runCaptureCheck = async (): Promise<void> => {
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    const collected = collectAcceptedCaptureAttempt(adapter);
    if (!collected) return;
    const progressAttemptId = activeAttemptId;

    processing = true;
    try {
      if (adapter.confirmCaptureAsync) {
        const confirmed = await adapter.confirmCaptureAsync(collected.capture, collected.detection);
        if (!confirmed) return;
        Object.assign(collected.capture, confirmed);
      }
      reportProgress(progressAttemptId, "SAVING");
      if (
        adapter.collectPerformanceAsync &&
        collected.capture.executionTime === undefined &&
        collected.capture.memoryValue === undefined
      ) {
        try {
          const performance = await adapter.collectPerformanceAsync(collected.capture);
          if (performance) Object.assign(collected.capture, performance);
        } catch {
          // Optional metrics must never prevent the accepted source capture.
        }
      }
      const response = await storeCaptureWithRetry(collected.capture);
      // A capture is consumed only after the service worker confirms local
      // persistence. Storage or channel failures remain retryable.
      if ((response as { ok?: unknown } | null)?.ok === true) {
        adapter.consumeSubmissionResult(collected.detection);
      }
      reportProgress(progressAttemptId, "CLEAR");
      if (activeAttemptId === progressAttemptId) activeAttemptId = null;
    } finally {
      processing = false;
      if (checkAfterProcessing) {
        checkAfterProcessing = false;
        scheduleCaptureCheck();
      }
    }
  };

  function scheduleCaptureCheck(): void {
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    if (checkScheduled) return;
    checkScheduled = true;
    // Several platform mutations arrive in one render turn. One microtask
    // keeps detection bounded without delaying the accepted-result capture.
    queueMicrotask(() => {
      checkScheduled = false;
      void runCaptureCheck();
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      let current: Element | null = target;
      while (current) {
        if (adapter.isSubmitControl(current)) {
          // The MAIN-world document_start listener runs before this isolated
          // document_idle listener and synchronously updates the platform's
          // source textarea at this click boundary.
          adapter.beginSubmissionAttempt(new Date());
          activeAttemptId = crypto.randomUUID();
          reportProgress(activeAttemptId, "CAPTURING");
          ensureResultPoll();
          scheduleCaptureCheck();
          break;
        }
        current = current.parentElement;
      }
    },
    true
  );

  document.defaultView?.addEventListener("pagehide", () => {
    reportProgress(activeAttemptId, "CLEAR");
    activeAttemptId = null;
  });

  const root = document.body ?? document.documentElement;
  if (root) {
    const observer = new MutationObserver(() => scheduleCaptureCheck());
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-modal"]
    });
  }
}

export async function bootstrapContent(
  document: Document,
  location: Location,
  referrer: string,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message)
): Promise<void> {
  const detailContext = createSweaProblemContext(document, location);
  if (detailContext) {
    await storeSweaProblemContext(document, location, send, detailContext.observedAt);
    return;
  }

  let sweaProblemUrl: string | null = null;
  let allowSweaQuerylessFallback = true;
  if (location.origin === SWEA_ORIGIN && location.pathname === SWEA_SOLVING_PATH) {
    const storedContext = await loadSweaProblemContextForReferrer(referrer, send);
    const resolution = resolveSweaProblem(document, location, referrer, storedContext);
    sweaProblemUrl = resolution.problemUrl;
    allowSweaQuerylessFallback = resolution.kind === "missing";
  }

  const adapter = createAdapter(document, location, sweaProblemUrl, allowSweaQuerylessFallback);
  if (adapter) startCapture(adapter, document, send);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  void bootstrapContent(document, window.location, document.referrer);
}
