import type { SweaSubmissionResultState } from "./adapters/swea/sweaSubmissionResult";
import { detectSweaSubmissionPerformance, type SweaSubmissionPerformanceResult } from "./adapters/swea/sweaSubmissionPerformance";
import { detectSweaSolvingProblemMeta } from "./adapters/swea/sweaSolvingProblemMeta";
import { detectSweaEditor } from "./adapters/swea/sweaEditor";
import { syncSweaEditor } from "./adapters/swea/sweaEditorSync";
import {
  cacheSweaFamilyContext,
  discoverSweaHistoryUrl,
  readCachedSweaFamilyContext,
  trustedFamilyContext,
  type SweaFamilyContext,
} from "./adapters/swea/sweaHistoryFallback";
import type { SubmissionPerformance } from "./solution";

export interface SweaAcceptedCapture { captureId: string; platform: "SWEA"; problemNumber: string; title: string; language: string; code: string; result: "ACCEPTED"; observedAt: string; solvedAt: string; performance?: SubmissionPerformance; }
export type SweaAutoSaveState = { status: "idle" } | { status: "saving"; observedAt: string } | { status: "saved" | "duplicate"; solutionId: string; savedAt: string } | { status: "failed"; observedAt: string; reason: "metadata_untrusted" | "editor_sync_failed" | "editor_incomplete" | "empty_code" | "invalid_capture" | "idempotency_conflict" | "storage_failed" | "confirmation_unknown" };
export type SaveResponse = { status: "saved" | "duplicate"; solutionId: string; savedAt: string } | { status: "rejected"; reason: "invalid_capture" | "idempotency_conflict" } | { status: "failed"; reason: "storage_failed" };
export const SAVE_SWEA_ACCEPTED = "CODEARCHIVE_SAVE_SWEA_ACCEPTED" as const;
const PERFORMANCE_WAIT_MS = 5_000;
const HISTORY_FORM_SELECTOR = "form#contestProbForm";
const SWEA_ORIGIN = "https://swexpertacademy.com";

export interface SweaHistoryFallbackDeps {
  referrer?: string;
  storage?: Storage;
  fetcher?: typeof fetch;
}

function isRetryablePerformanceResult(result: SweaSubmissionPerformanceResult): boolean {
  return result.status === "incomplete"
    && (result.reason === "no_trusted_candidate" || result.reason === "metrics_missing");
}

export async function waitForSweaSubmissionPerformance(
  document: Document,
  observedAt: string,
  timeoutMs: number = PERFORMANCE_WAIT_MS,
): Promise<SweaSubmissionPerformanceResult> {
  const initial = detectSweaSubmissionPerformance(document, observedAt);
  if (!isRetryablePerformanceResult(initial) || timeoutMs <= 0) return initial;

  const historyForm = document.querySelector(HISTORY_FORM_SELECTOR);
  if (!historyForm) return initial;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SweaSubmissionPerformanceResult) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(result);
    };

    const observer = new MutationObserver(() => {
      const result = detectSweaSubmissionPerformance(document, observedAt);
      if (result.status === "detected" || !isRetryablePerformanceResult(result)) finish(result);
    });

    observer.observe(historyForm, { childList: true, subtree: true, characterData: true });
    const timeoutId = setTimeout(() => finish(detectSweaSubmissionPerformance(document, observedAt)), timeoutMs);
  });
}

function resolveFamilyContext(document: Document, contestProbId: string, deps: SweaHistoryFallbackDeps): SweaFamilyContext | null {
  const storage = deps.storage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  const referrer = deps.referrer ?? document.referrer;
  const fresh = trustedFamilyContext(referrer, contestProbId);
  if (fresh) {
    try { storage && cacheSweaFamilyContext(storage, fresh); } catch { /* fail closed without cache */ }
    return fresh;
  }
  try { return storage ? readCachedSweaFamilyContext(storage, contestProbId) : null; }
  catch { return null; }
}

async function detectPerformanceFromDiscoveredHistory(
  document: Document,
  contestProbId: string,
  observedAt: string,
  deps: SweaHistoryFallbackDeps,
): Promise<SweaSubmissionPerformanceResult | null> {
  const context = resolveFamilyContext(document, contestProbId, deps);
  if (!context) return null;
  const fetcher = deps.fetcher ?? fetch;
  try {
    const detailUrl = new URL(context.referrerUrl);
    if (detailUrl.origin !== SWEA_ORIGIN) return null;
    const detailResponse = await fetcher(detailUrl.href, { credentials: "same-origin" });
    if (!detailResponse.ok) return null;
    const detailDocument = new DOMParser().parseFromString(await detailResponse.text(), "text/html");
    const historyUrl = discoverSweaHistoryUrl(detailDocument, detailUrl.href, context.family);
    if (!historyUrl) return null;
    const parsedHistoryUrl = new URL(historyUrl);
    if (parsedHistoryUrl.origin !== SWEA_ORIGIN) return null;
    const historyResponse = await fetcher(parsedHistoryUrl.href, { credentials: "same-origin" });
    if (!historyResponse.ok) return null;
    const historyDocument = new DOMParser().parseFromString(await historyResponse.text(), "text/html");
    return detectSweaSubmissionPerformance(historyDocument, observedAt, contestProbId);
  } catch {
    return null;
  }
}

export async function captureAccepted(document: Document, url: URL, observation: Extract<SweaSubmissionResultState, { status: "observed" }>, send: (message: unknown) => Promise<SaveResponse>, uuid: () => string = () => crypto.randomUUID(), sync: typeof syncSweaEditor = syncSweaEditor, performanceWaitMs: number = PERFORMANCE_WAIT_MS, fallbackDeps: SweaHistoryFallbackDeps = {}): Promise<SweaAutoSaveState> {
  const observedAt = observation.submission.observedAt;
  if (observation.submission.result !== "ACCEPTED") return { status: "idle" };
  const metadata = detectSweaSolvingProblemMeta(document, url);
  if (metadata.status !== "detected") return { status: "failed", observedAt, reason: "metadata_untrusted" };
  if (sync(document).status !== "synced") return { status: "failed", observedAt, reason: "editor_sync_failed" };
  const editor = detectSweaEditor(document, url);
  if (editor.status !== "detected") return { status: "failed", observedAt, reason: "editor_incomplete" };
  if (!editor.editor.code.trim()) return { status: "failed", observedAt, reason: "empty_code" };

  let performanceResult = await waitForSweaSubmissionPerformance(document, observedAt, performanceWaitMs);
  const contestProbId = metadata.problem.contestProbId;
  if (
    performanceResult.status !== "detected"
    && contestProbId
    && performanceResult.reason !== "ambiguous_candidate"
    && performanceResult.reason !== "identity_mismatch"
  ) {
    const fallbackResult = await detectPerformanceFromDiscoveredHistory(document, contestProbId, observedAt, fallbackDeps);
    if (fallbackResult?.status === "detected") performanceResult = fallbackResult;
  }

  const capture: SweaAcceptedCapture = {
    captureId: uuid(), platform: "SWEA", problemNumber: metadata.problem.problemNumber, title: metadata.problem.title,
    language: editor.editor.language ?? "", code: editor.editor.code, result: "ACCEPTED", observedAt,
    solvedAt: new Date(observedAt).toLocaleDateString("en-CA"),
    ...(performanceResult.status === "detected" ? { performance: performanceResult.performance } : {}),
  };
  if (!capture.language.trim()) return { status: "failed", observedAt, reason: "editor_incomplete" };
  try {
    const response = await send({ type: SAVE_SWEA_ACCEPTED, capture });
    if (response.status === "saved" || response.status === "duplicate") return response;
    if (response.status === "rejected") return { status: "failed", observedAt, reason: response.reason };
    return { status: "failed", observedAt, reason: "storage_failed" };
  } catch { return { status: "failed", observedAt, reason: "confirmation_unknown" }; }
}
