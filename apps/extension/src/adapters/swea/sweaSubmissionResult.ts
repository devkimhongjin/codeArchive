export type SubmissionResultCode =
  | "ACCEPTED"
  | "WRONG_ANSWER"
  | "TIME_LIMIT_EXCEEDED"
  | "MEMORY_LIMIT_EXCEEDED"
  | "RUNTIME_ERROR"
  | "COMPILE_ERROR"
  | "OUTPUT_FORMAT_ERROR"
  | "PARTIAL_SCORE"
  | "UNKNOWN";

export interface SweaObservedSubmissionResult {
  result: SubmissionResultCode;
  observedAt: string;
}

export type SweaSubmissionResultState =
  | { status: "none" }
  | { status: "observed"; submission: SweaObservedSubmissionResult; warnings: string[] };

type ObservationHandler = (state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void | boolean | Promise<void | boolean>;

const RESULT_SELECTOR = "div.popup_layer.show > div > p.txt";
const UNKNOWN_RESULT_WARNING = "SWEA 제출 결과를 표준 코드로 식별하지 못했습니다.";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function mapSweaVisibleSubmissionResult(
  text: string,
  observedAt: Date,
): Extract<SweaSubmissionResultState, { status: "observed" }> | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const result = normalized.includes("pass입니다") ? "ACCEPTED" : "UNKNOWN";
  return {
    status: "observed",
    submission: { result, observedAt: observedAt.toISOString() },
    warnings: result === "UNKNOWN" ? [UNKNOWN_RESULT_WARNING] : [],
  };
}

export function observeSweaSubmissionResult(
  document: Document,
  onObservation: ObservationHandler,
  now: () => Date = () => new Date(),
): () => void {
  let observedInVisibleCycle = false;
  let observationInFlight = false;
  let visibleCycle = 0;

  const inspectVisibleResult = () => {
    const resultText = document.querySelector(RESULT_SELECTOR)?.textContent ?? "";
    const observation = mapSweaVisibleSubmissionResult(resultText, now());
    if (!observation) {
      observedInVisibleCycle = false;
      visibleCycle += 1;
      return;
    }
    if (observation.submission.result !== "ACCEPTED") {
      observedInVisibleCycle = false;
      onObservation(observation);
      return;
    }
    if (observedInVisibleCycle || observationInFlight) return;

    const cycle = visibleCycle;
    let handled: void | boolean | Promise<void | boolean>;
    try { handled = onObservation(observation); }
    catch { handled = false; }
    if (handled && typeof (handled as Promise<void | boolean>).then === "function") {
      observationInFlight = true;
      Promise.resolve(handled).then((result) => {
        observationInFlight = false;
        if (cycle !== visibleCycle) return;
        observedInVisibleCycle = result !== false;
      }, () => {
        observationInFlight = false;
        if (cycle === visibleCycle) observedInVisibleCycle = false;
      });
    } else {
      observedInVisibleCycle = handled !== false;
    }
  };

  inspectVisibleResult();

  const root = document.body;
  if (!root) return () => undefined;

  const observer = new MutationObserver(inspectVisibleResult);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
