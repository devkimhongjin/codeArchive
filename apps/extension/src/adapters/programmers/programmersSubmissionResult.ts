import type { SubmissionPerformance } from "../../solution";
import { findProgrammersResultGroup, parseProgrammersPerformanceGroup, resultGroupMutationRelevant } from "./programmersPerformance";

export interface ProgrammersObservedSubmissionResult {
  result: "ACCEPTED";
  observedAt: string;
}

export type ProgrammersSubmissionResultState =
  | { status: "none" }
  | { status: "observed"; submission: ProgrammersObservedSubmissionResult; warnings: string[] };

const ACCEPTED_DIALOG_SELECTOR = "#modal-dialog.modal.show[role='dialog'][aria-modal='true']";
const ACCEPTED_TITLE_SELECTOR = "h4.modal-title";
const MAX_SETTLE_MS = 2_000;
const MAX_INSPECTIONS = 6;
const SETTLE_DELAYS_MS = [0, 100, 200, 400, 600, 700];

function acceptedDialog(document: Document): Element | null {
  const dialog = document.querySelector(ACCEPTED_DIALOG_SELECTOR);
  const title = dialog?.querySelector(ACCEPTED_TITLE_SELECTOR)?.textContent?.replace(/\s+/g, " ").trim();
  return title === "정답입니다!" ? dialog : null;
}

export interface ProgrammersAcceptedCycle {
  getPerformance(): Promise<SubmissionPerformance | undefined>;
  notify(records: readonly MutationRecord[]): void;
  invalidate(): void;
}

function pageContext(document: Document): string {
  return document.location?.href ?? "";
}

function createAcceptedCycle(
  document: Document,
  dialog: Element,
  initialRecords: readonly MutationRecord[],
): ProgrammersAcceptedCycle {
  const initialContext = pageContext(document);
  const startedAt = Date.now();
  let invalidated = false;
  let freshResultMutation = resultGroupMutationRelevant(document, initialRecords);
  let inspections = 0;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePerformance: (value: SubmissionPerformance | undefined) => void = () => undefined;
  const performancePromise = new Promise<SubmissionPerformance | undefined>((resolve) => { resolvePerformance = resolve; });

  const finish = (performance: SubmissionPerformance | undefined) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    resolvePerformance(performance);
  };

  const isCurrent = () => !invalidated && pageContext(document) === initialContext && dialog.ownerDocument === document;

  const inspect = () => {
    if (settled) return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!isCurrent() || Date.now() - startedAt > MAX_SETTLE_MS || inspections >= MAX_INSPECTIONS) {
      finish(undefined);
      return;
    }
    inspections += 1;
    const group = findProgrammersResultGroup(document);
    if (freshResultMutation && group) {
      const performance = parseProgrammersPerformanceGroup(group);
      if (performance) {
        finish(performance);
        return;
      }
    }
    const elapsed = Date.now() - startedAt;
    const delay = SETTLE_DELAYS_MS[inspections] ?? MAX_SETTLE_MS - elapsed;
    if (elapsed + delay > MAX_SETTLE_MS) {
      finish(undefined);
      return;
    }
    timer = setTimeout(inspect, Math.max(0, delay));
  };

  inspect();

  return {
    getPerformance: () => performancePromise,
    notify(records) {
      if (settled || !isCurrent()) {
        if (!settled) finish(undefined);
        return;
      }
      if (!resultGroupMutationRelevant(document, records)) return;
      freshResultMutation = true;
      inspect();
    },
    invalidate() { finish(undefined); },
  };
}

export function observeProgrammersSubmissionResult(
  document: Document,
  onObservation: (
    state: Extract<ProgrammersSubmissionResultState, { status: "observed" }>,
    cycle?: ProgrammersAcceptedCycle,
  ) => void,
  now: () => Date = () => new Date(),
): () => void {
  let observedDialog: Element | null = null;
  let activeCycle: ProgrammersAcceptedCycle | undefined;

  const inspect = (records: readonly MutationRecord[] = []) => {
    const dialog = acceptedDialog(document);
    if (!dialog) {
      observedDialog = null;
      activeCycle?.notify(records);
      return;
    }
    if (observedDialog === dialog) {
      activeCycle?.notify(records);
      return;
    }
    activeCycle?.invalidate();
    observedDialog = dialog;
    const observation: Extract<ProgrammersSubmissionResultState, { status: "observed" }> = {
      status: "observed",
      submission: { result: "ACCEPTED", observedAt: now().toISOString() },
      warnings: [],
    };
    const isInitialHistoricalState = records.length === 0;
    activeCycle = isInitialHistoricalState ? undefined : createAcceptedCycle(document, dialog, records);
    if (activeCycle) onObservation(observation, activeCycle);
    else onObservation(observation);
  };

  inspect();
  if (!document.body) return () => undefined;
  const observer = new MutationObserver(inspect);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: ["class", "style", "aria-modal"],
  });
  return () => {
    observer.disconnect();
    activeCycle?.invalidate();
  };
}
