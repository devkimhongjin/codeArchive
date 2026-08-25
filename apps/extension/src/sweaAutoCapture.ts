import type { SweaSubmissionResultState } from "./adapters/swea/sweaSubmissionResult";
import { detectSweaSubmissionPerformance, type SweaSubmissionPerformanceResult } from "./adapters/swea/sweaSubmissionPerformance";
import { detectSweaSolvingProblemMeta } from "./adapters/swea/sweaSolvingProblemMeta";
import { detectSweaEditor } from "./adapters/swea/sweaEditor";
import { syncSweaEditor } from "./adapters/swea/sweaEditorSync";
import type { SubmissionPerformance } from "./solution";

export interface SweaAcceptedCapture { captureId: string; platform: "SWEA"; problemNumber: string; title: string; language: string; code: string; result: "ACCEPTED"; observedAt: string; solvedAt: string; performance?: SubmissionPerformance; }
export type SweaAutoSaveState = { status: "idle" } | { status: "saving"; observedAt: string } | { status: "saved" | "duplicate"; solutionId: string; savedAt: string } | { status: "failed"; observedAt: string; reason: "metadata_untrusted" | "editor_sync_failed" | "editor_incomplete" | "empty_code" | "invalid_capture" | "idempotency_conflict" | "storage_failed" | "confirmation_unknown" };
export type SaveResponse = { status: "saved" | "duplicate"; solutionId: string; savedAt: string } | { status: "rejected"; reason: "invalid_capture" | "idempotency_conflict" } | { status: "failed"; reason: "storage_failed" };
export const SAVE_SWEA_ACCEPTED = "CODEARCHIVE_SAVE_SWEA_ACCEPTED" as const;
const PERFORMANCE_WAIT_MS = 5_000;
const HISTORY_FORM_SELECTOR = "form#contestProbForm";

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

export async function captureAccepted(document: Document, url: URL, observation: Extract<SweaSubmissionResultState, { status: "observed" }>, send: (message: unknown) => Promise<SaveResponse>, uuid: () => string = () => crypto.randomUUID(), sync: typeof syncSweaEditor = syncSweaEditor, performanceWaitMs: number = PERFORMANCE_WAIT_MS): Promise<SweaAutoSaveState> {
  const observedAt = observation.submission.observedAt;
  if (observation.submission.result !== "ACCEPTED") return { status: "idle" };
  const metadata = detectSweaSolvingProblemMeta(document, url);
  if (metadata.status !== "detected") return { status: "failed", observedAt, reason: "metadata_untrusted" };
  if (sync(document).status !== "synced") return { status: "failed", observedAt, reason: "editor_sync_failed" };
  const editor = detectSweaEditor(document, url);
  if (editor.status !== "detected") return { status: "failed", observedAt, reason: "editor_incomplete" };
  if (!editor.editor.code.trim()) return { status: "failed", observedAt, reason: "empty_code" };
  const performanceResult = await waitForSweaSubmissionPerformance(document, observedAt, performanceWaitMs);
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
