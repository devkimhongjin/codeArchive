import type { ProblemDetectionResult } from "../adapters/platformAdapter";
import { sweaAdapter, getSweaPageKind } from "../adapters/swea/sweaAdapter";
import { detectSweaEditor } from "../adapters/swea/sweaEditor";
import { syncSweaEditor } from "../adapters/swea/sweaEditorSync";
import type { SweaSubmissionResultState } from "../adapters/swea/sweaSubmissionResult";

export function getSweaPageContext(
  document: Document,
  url: URL,
  submissionResult: SweaSubmissionResultState,
): ProblemDetectionResult {
  const syncResult = getSweaPageKind(url) === "solving" ? syncSweaEditor(document) : null;
  let result = sweaAdapter.detect(document, url);

  if (result.status === "connected_page" && syncResult?.status === "failed") {
    result = { ...result, editor: detectSweaEditor(document, url, false) };
  }

  return result.status === "connected_page"
    ? { ...result, submissionResult }
    : result;
}
