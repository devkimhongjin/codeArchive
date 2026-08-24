import { getSweaPageKind } from "../adapters/swea/sweaAdapter";
import {
  observeSweaSubmissionResult,
  type SweaSubmissionResultState,
} from "../adapters/swea/sweaSubmissionResult";

type ObserveSubmissionResult = typeof observeSweaSubmissionResult;

export interface SweaSubmissionResultStore {
  getState(): SweaSubmissionResultState;
  cleanup(): void;
}

export function createSweaSubmissionResultStore(
  document: Document,
  url: URL,
  observe: ObserveSubmissionResult = observeSweaSubmissionResult,
  onObservation?: (state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void,
): SweaSubmissionResultStore {
  let state: SweaSubmissionResultState = { status: "none" };
  const cleanup = getSweaPageKind(url) === "solving"
    ? observe(document, (observation) => { state = observation; onObservation?.(observation); })
    : () => undefined;

  return { getState: () => state, cleanup };
}
