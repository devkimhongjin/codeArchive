import type { ProblemDetectionResult } from "../adapters/platformAdapter";
import { programmersAdapter } from "../adapters/programmers/programmersAdapter";
import { detectProgrammersEditor } from "../adapters/programmers/programmersEditor";
import type { ProgrammersSubmissionResultState } from "../adapters/programmers/programmersSubmissionResult";
import type { ProgrammersAutoSaveState } from "../programmersAutoCapture";

export function getProgrammersPageContext(
  document: Document,
  url: URL,
  submissionResult: ProgrammersSubmissionResultState,
  autoSave: ProgrammersAutoSaveState = { status: "idle" },
): ProblemDetectionResult {
  const metadata = programmersAdapter.detect(document, url);
  if (metadata.status !== "detected") return metadata;
  return {
    status: "connected_page",
    platform: "PROGRAMMERS",
    pageKind: "lesson",
    url: metadata.problem.url,
    problem: metadata.problem,
    editor: detectProgrammersEditor(document),
    submissionResult,
    autoSave,
  };
}
