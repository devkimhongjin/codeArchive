export interface ProgrammersObservedSubmissionResult {
  result: "ACCEPTED";
  observedAt: string;
}

export type ProgrammersSubmissionResultState =
  | { status: "none" }
  | { status: "observed"; submission: ProgrammersObservedSubmissionResult; warnings: string[] };

const ACCEPTED_DIALOG_SELECTOR = "#modal-dialog.modal.show[role='dialog'][aria-modal='true']";
const ACCEPTED_TITLE_SELECTOR = "h4.modal-title";

function acceptedDialog(document: Document): Element | null {
  const dialog = document.querySelector(ACCEPTED_DIALOG_SELECTOR);
  const title = dialog?.querySelector(ACCEPTED_TITLE_SELECTOR)?.textContent?.replace(/\s+/g, " ").trim();
  return title === "정답입니다!" ? dialog : null;
}

export function observeProgrammersSubmissionResult(
  document: Document,
  onObservation: (state: Extract<ProgrammersSubmissionResultState, { status: "observed" }>) => void,
  now: () => Date = () => new Date(),
): () => void {
  let observedDialog: Element | null = null;

  const inspect = () => {
    const dialog = acceptedDialog(document);
    if (!dialog) {
      observedDialog = null;
      return;
    }
    if (observedDialog === dialog) return;
    observedDialog = dialog;
    onObservation({
      status: "observed",
      submission: { result: "ACCEPTED", observedAt: now().toISOString() },
      warnings: [],
    });
  };

  inspect();
  if (!document.body) return () => undefined;
  const observer = new MutationObserver(inspect);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-modal"],
  });
  return () => observer.disconnect();
}
