import { createAdapter } from "./adapters";
import { collectAcceptedCaptureAttempt } from "./capture";
import type { Capture, PlatformAdapter } from "./types";
import { canonicalLanguageKey } from "../../../shared/language";
import { BUILD_METADATA } from "../../../shared/buildMetadata";
import { importVisibleJungolHistory, isJungolHistoryPath, loadJungolHistoryPreview, previewJungolHistory } from "./historicalJungol";
import { loadSweaHistoryPreview } from "./historicalSwea";
import { previewProgrammersHistory } from "./historicalProgrammers";
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

function extensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/i.test(error.message);
}

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
  // Keep the site's exact language through submission verification, then store
  // Java versions under one name across all platforms.
  const storedCapture = canonicalLanguageKey(capture.language) === "java"
    ? { ...capture, language: "Java", languageKey: "java" }
    : capture;
  let response: unknown;
  for (let attempt = 0; attempt <= STORE_CAPTURE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await send({ type: "STORE_CAPTURE", capture: storedCapture });
      if ((response as { ok?: unknown } | null)?.ok === true) return response;
    } catch (error) {
      // Reloading an unpacked extension permanently invalidates the old tab's
      // content-script context. Retrying that context cannot reach the worker.
      if (extensionContextInvalidated(error)) return undefined;
      response = undefined;
    }

    const delay = STORE_CAPTURE_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }
  return response;
}

export function startCapture(adapter: PlatformAdapter, document: Document, send: SendRuntimeMessage): void {
  document.documentElement?.setAttribute("data-codearchive-content-build", BUILD_METADATA.buildId);
  let processing = false;
  let invalidated = false;
  let checkScheduled = false;
  let checkAfterProcessing = false;
  let resultPoll: ReturnType<typeof setInterval> | null = null;
  let observer: MutationObserver | null = null;
  let activeAttemptId: string | null = null;

  function markCaptureStage(stage: string, attemptId: string | null = activeAttemptId): void {
    if (adapter.platform !== "PROGRAMMERS" || (attemptId && attemptId !== activeAttemptId)) return;
    // A non-sensitive, page-local diagnostic for the next real submission.
    // Never include source, identity, capture IDs, or runtime error messages.
    document.documentElement?.setAttribute("data-codearchive-capture-stage", stage);
  }

  function stopInvalidatedContext(): void {
    if (invalidated) return;
    invalidated = true;
    markCaptureStage("context-invalidated");
    if (resultPoll !== null) clearInterval(resultPoll);
    resultPoll = null;
    observer?.disconnect();
    const root = document.body ?? document.documentElement;
    if (!root || document.getElementById("codearchive-reload-required")) return;
    const notice = document.createElement("div");
    notice.id = "codearchive-reload-required";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;z-index:2147483647;bottom:16px;left:16px;right:16px;padding:14px 18px;background:#fff4e5;color:#442b08;border:2px solid #c77700;border-radius:8px;font:14px/1.5 sans-serif;box-shadow:0 4px 16px #0003";
    notice.textContent = "CodeArchive 확장 프로그램이 갱신되어 이 탭의 자동 수집이 중단되었습니다. 코드와 저장 여부를 확인한 뒤 이 문제 탭을 새로고침하고 다시 제출해 주세요.";
    root.prepend(notice);
  }

  async function sendTracked(message: unknown): Promise<unknown> {
    try {
      return await send(message);
    } catch (error) {
      if (extensionContextInvalidated(error)) stopInvalidatedContext();
      throw error;
    }
  }

  function reportProgress(attemptId: string | null, phase: "CAPTURING" | "SAVING" | "CLEAR"): void {
    if (!attemptId || invalidated) return;
    const problem = adapter.detectProblem();
    if (phase === "CAPTURING" && !problem) return;
    void sendTracked({
      type: "SET_SUBMISSION_PROGRESS", attemptId, platform: adapter.platform, phase,
      ...(problem ? { problemNumber: problem.problemNumber, title: problem.title } : {})
    }).catch(() => undefined);
  }

  function ensureResultPoll(): void {
    if (invalidated || !adapter.hasPendingSubmissionAttempt || resultPoll !== null) return;
    resultPoll = setInterval(() => {
      if (!adapter.hasPendingSubmissionAttempt?.()) {
        clearInterval(resultPoll!);
        resultPoll = null;
        reportProgress(activeAttemptId, "CLEAR");
        if (document.documentElement?.getAttribute("data-codearchive-capture-stage") !== "store-acknowledged") {
          markCaptureStage("result-timeout");
        }
        activeAttemptId = null;
        return;
      }
      scheduleCaptureCheck();
    }, 300);
  }

  const runCaptureCheck = async (): Promise<void> => {
    if (invalidated) return;
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    const collected = collectAcceptedCaptureAttempt(adapter);
    if (!collected) return;
    const progressAttemptId = activeAttemptId;

    markCaptureStage("accepted", progressAttemptId);

    processing = true;
    try {
      if (adapter.confirmCaptureAsync) {
        const confirmed = await adapter.confirmCaptureAsync(collected.capture, collected.detection);
        if (!confirmed) {
          markCaptureStage("result-unverified", progressAttemptId);
          return;
        }
        Object.assign(collected.capture, confirmed);
      }
      reportProgress(progressAttemptId, "SAVING");
      markCaptureStage("saving", progressAttemptId);
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
      const response = await storeCaptureWithRetry(collected.capture, sendTracked);
      // A capture is consumed only after the service worker confirms local
      // persistence. Storage or channel failures remain retryable.
      if ((response as { ok?: unknown } | null)?.ok === true) {
        adapter.consumeSubmissionResult(collected.detection);
        markCaptureStage("store-acknowledged", progressAttemptId);
      } else {
        markCaptureStage("store-unavailable", progressAttemptId);
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
    if (invalidated) return;
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
      if (invalidated) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      let current: Element | null = target;
      while (current) {
        if (adapter.isSubmitControl(current)) {
          if ((adapter.platform === "JUNGOL" || adapter.platform === "PROGRAMMERS") && !adapter.detectProblem()) break;
          // The MAIN-world document_start listener runs before this isolated
          // document_idle listener and synchronously updates the platform's
          // source textarea at this click boundary.
          adapter.beginSubmissionAttempt(new Date());
          activeAttemptId = crypto.randomUUID();
          if (adapter.platform === "PROGRAMMERS") {
            const snapshot = adapter.getSubmissionSnapshot?.();
            markCaptureStage(!snapshot?.problem || !snapshot.editor ? "snapshot-missing" : "waiting-result");
          }
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
    observer = new MutationObserver(() => {
      if (adapter.platform === "SWEA" || adapter.hasPendingSubmissionAttempt?.()) scheduleCaptureCheck();
    });
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
  if (location.origin === SWEA_ORIGIN && location.pathname === SWEA_USER_SUBMISSIONS_PATH) {
    return;
  }
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
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const object = message !== null && typeof message === "object" ? message as Record<string, unknown> : null;
    if (object?.type === "HISTORY_PREVIEW") {
      if (window.location.origin === "https://jungol.co.kr" && isJungolHistoryPath(window.location.pathname)) {
        void loadJungolHistoryPreview(document, window.location).then(sendResponse);
        return true;
      } else if (window.location.origin === SWEA_ORIGIN && window.location.pathname === SWEA_USER_SUBMISSIONS_PATH) {
        void loadSweaHistoryPreview(document, window.location).then(sendResponse);
        return true;
      } else if (window.location.origin === "https://school.programmers.co.kr" && window.location.pathname === "/learn/challenges") {
        sendResponse(previewProgrammersHistory(document, window.location));
      } else sendResponse({ status: "TAB_NOT_FOUND" });
      return false;
    }
    if (object?.type === "HISTORY_IMPORT") {
      const ids = object.submissionIds;
      if (window.location.origin !== "https://jungol.co.kr" || !isJungolHistoryPath(window.location.pathname) ||
          !Array.isArray(ids) || ids.length < 1 || ids.length > 10 ||
          ids.some(id => typeof id !== "string" || !/^\d{1,40}$/.test(id)) || new Set(ids).size !== ids.length) {
        sendResponse({ status: "BAD_REQUEST" });
        return false;
      }
      const preview = previewJungolHistory(document, window.location);
      const selected = preview.status === "READY" ? ids.map(id => preview.candidates.find(candidate => candidate.submissionId === id)) : [];
      if (selected.length !== ids.length || selected.some(candidate => !candidate)) {
        sendResponse({ status: "STALE_PREVIEW" });
        return false;
      }
      void importVisibleJungolHistory(document, window.location, selected as NonNullable<typeof selected[number]>[],
        capture => chrome.runtime.sendMessage({ type: "STORE_HISTORICAL_CAPTURE", capture }))
        .then(result => sendResponse({ status: "DONE", ...result }))
        .catch(() => sendResponse({ status: "FAILED" }));
      return true;
    }
    return false;
  });
  void bootstrapContent(document, window.location, document.referrer);
}
