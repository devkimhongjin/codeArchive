import { SAVE_ACCEPTED_CAPTURE, type AcceptedCapture } from "./acceptedCapture";
import { programmersAdapter } from "./adapters/programmers/programmersAdapter";
import { detectProgrammersEditor } from "./adapters/programmers/programmersEditor";
import type { ProgrammersSubmissionResultState } from "./adapters/programmers/programmersSubmissionResult";
import type { ProgrammersAcceptedCycle } from "./adapters/programmers/programmersSubmissionResult";
import type { SaveResponse } from "./sweaAutoCapture";

export type ProgrammersAutoSaveState =
  | { status: "idle" }
  | { status: "saving"; observedAt: string }
  | { status: "saved" | "duplicate"; solutionId: string; savedAt: string }
  | { status: "failed"; observedAt: string; reason: "metadata_untrusted" | "editor_incomplete" | "empty_code" | "invalid_capture" | "idempotency_conflict" | "storage_failed" | "confirmation_unknown" };

export async function captureProgrammersAccepted(
  document: Document,
  url: URL,
  observation: Extract<ProgrammersSubmissionResultState, { status: "observed" }>,
  send: (message: unknown) => Promise<SaveResponse>,
  uuid: () => string = () => crypto.randomUUID(),
  cycle?: ProgrammersAcceptedCycle,
): Promise<ProgrammersAutoSaveState> {
  const observedAt = observation.submission.observedAt;
  const metadata = programmersAdapter.detect(document, url);
  if (metadata.status !== "detected") return { status: "failed", observedAt, reason: "metadata_untrusted" };

  const editor = detectProgrammersEditor(document);
  if (editor.status !== "detected" || !editor.editor.language.trim()) {
    return { status: "failed", observedAt, reason: "editor_incomplete" };
  }
  if (!editor.editor.code.trim()) return { status: "failed", observedAt, reason: "empty_code" };

  const performance = await cycle?.getPerformance();

  const capture: AcceptedCapture = {
    captureId: uuid(),
    platform: "PROGRAMMERS",
    problemNumber: metadata.problem.problemNumber,
    title: metadata.problem.title,
    language: editor.editor.language,
    code: editor.editor.code,
    result: "ACCEPTED",
    observedAt,
    solvedAt: new Date(observedAt).toLocaleDateString("en-CA"),
    problemUrl: metadata.problem.url,
    ...(performance ? { performance } : {}),
  };

  try {
    const response = await send({ type: SAVE_ACCEPTED_CAPTURE, capture });
    if (response.status === "saved" || response.status === "duplicate") return response;
    if (response.status === "rejected") return { status: "failed", observedAt, reason: response.reason };
    return { status: "failed", observedAt, reason: "storage_failed" };
  } catch {
    return { status: "failed", observedAt, reason: "confirmation_unknown" };
  }
}
