import type { SweaSubmissionResultState } from "./adapters/swea/sweaSubmissionResult";
import { detectSweaSolvingProblemMeta } from "./adapters/swea/sweaSolvingProblemMeta";
import { detectSweaEditor } from "./adapters/swea/sweaEditor";
import { syncSweaEditor } from "./adapters/swea/sweaEditorSync";
import { fetchSweaPerformance } from "./adapters/swea/sweaPerformance";
import type { AcceptedCapture } from "./acceptedCapture";
import type { SubmissionPerformance } from "./solution";

export interface SweaAcceptedCapture extends AcceptedCapture { platform: "SWEA"; }
export type SweaAutoSaveState = { status: "idle" } | { status: "saving"; observedAt: string } | { status: "saved" | "duplicate"; solutionId: string; savedAt: string } | { status: "failed"; observedAt: string; reason: "metadata_untrusted" | "editor_sync_failed" | "editor_incomplete" | "empty_code" | "invalid_capture" | "idempotency_conflict" | "storage_failed" | "confirmation_unknown" };
export type SaveResponse = { status: "saved" | "duplicate"; solutionId: string; savedAt: string } | { status: "rejected"; reason: "invalid_capture" | "idempotency_conflict" } | { status: "failed"; reason: "storage_failed" };
export const SAVE_SWEA_ACCEPTED = "CODEARCHIVE_SAVE_SWEA_ACCEPTED" as const;
export const UPDATE_SWEA_CAPTURE_PERFORMANCE = "CODEARCHIVE_UPDATE_SWEA_CAPTURE_PERFORMANCE" as const;

export type SweaPerformanceEnricher = (
  solutionId: string,
  savedAt: string,
  performance: SubmissionPerformance,
) => Promise<unknown>;

export async function captureAccepted(document: Document, url: URL, observation: Extract<SweaSubmissionResultState, { status: "observed" }>, send: (message: unknown) => Promise<SaveResponse>, uuid: () => string = () => crypto.randomUUID(), sync: typeof syncSweaEditor = syncSweaEditor, enrich: typeof fetchSweaPerformance = fetchSweaPerformance, handoffProblemContestId: string | null = null, enrichSavedCapture: SweaPerformanceEnricher = async () => undefined): Promise<SweaAutoSaveState> {
  const observedAt = observation.submission.observedAt;
  if (observation.submission.result !== "ACCEPTED") return { status: "idle" };
  const metadata = detectSweaSolvingProblemMeta(document, url, handoffProblemContestId);
  if (metadata.status !== "detected") return { status: "failed", observedAt, reason: "metadata_untrusted" };
  if (sync(document).status !== "synced") return { status: "failed", observedAt, reason: "editor_sync_failed" };
  const editor = detectSweaEditor(document, url);
  if (editor.status !== "detected") return { status: "failed", observedAt, reason: "editor_incomplete" };
  if (!editor.editor.code.trim()) return { status: "failed", observedAt, reason: "empty_code" };
  const capture: SweaAcceptedCapture = { captureId: uuid(), platform: "SWEA", problemNumber: metadata.problem.problemNumber, title: metadata.problem.title, language: editor.editor.language ?? "", code: editor.editor.code, result: "ACCEPTED", observedAt, solvedAt: new Date(observedAt).toLocaleDateString("en-CA"), problemUrl: url.href };
  if (!capture.language.trim()) return { status: "failed", observedAt, reason: "editor_incomplete" };
  try {
    const response = await send({ type: SAVE_SWEA_ACCEPTED, capture });
    if (response.status === "saved") {
      void Promise.resolve()
        .then(() => enrich(document, url, metadata.problem.problemContestId, editor.editor.code, observedAt))
        .then((performance) => performance ? enrichSavedCapture(response.solutionId, response.savedAt, performance) : undefined)
        .catch(() => undefined);
      return response;
    }
    if (response.status === "duplicate") return response;
    if (response.status === "rejected") return { status: "failed", observedAt, reason: response.reason };
    return { status: "failed", observedAt, reason: "storage_failed" };
  } catch { return { status: "failed", observedAt, reason: "confirmation_unknown" }; }
}
