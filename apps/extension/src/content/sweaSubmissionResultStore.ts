import { getSweaPageKind } from "../adapters/swea/sweaAdapter";
import { detectSweaSolvingProblemMeta } from "../adapters/swea/sweaSolvingProblemMeta";
import {
  observeSweaSubmissionResult,
  type SweaSubmissionResultState,
} from "../adapters/swea/sweaSubmissionResult";

type ObserveSubmissionResult = typeof observeSweaSubmissionResult;

export interface SweaSubmissionResultStore {
  getState(): SweaSubmissionResultState;
  cleanup(): void;
}

const CACHE_PREFIX = "codearchive:swea:submission-result:";

function cacheKey(document: Document, url: URL): string | null {
  const metadata = detectSweaSolvingProblemMeta(document, url);
  if (metadata.status !== "detected" || !metadata.problem.contestProbId) return null;
  return `${CACHE_PREFIX}${metadata.problem.contestProbId}`;
}

function readCachedState(storage: Storage | undefined, key: string | null): SweaSubmissionResultState {
  if (!storage || !key) return { status: "none" };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { status: "none" };
    const parsed = JSON.parse(raw) as SweaSubmissionResultState;
    if (parsed.status !== "observed") return { status: "none" };
    if (!parsed.submission?.observedAt || !["ACCEPTED", "WRONG_ANSWER", "UNKNOWN"].includes(parsed.submission.result)) {
      return { status: "none" };
    }
    return parsed;
  } catch {
    return { status: "none" };
  }
}

function writeCachedState(storage: Storage | undefined, key: string | null, state: SweaSubmissionResultState): void {
  if (!storage || !key || state.status !== "observed") return;
  try { storage.setItem(key, JSON.stringify(state)); } catch { /* memory state remains authoritative */ }
}

export function createSweaSubmissionResultStore(
  document: Document,
  url: URL,
  observe: ObserveSubmissionResult = observeSweaSubmissionResult,
  onObservation?: (state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void,
  storage: Storage | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage,
): SweaSubmissionResultStore {
  const key = getSweaPageKind(url) === "solving" ? cacheKey(document, url) : null;
  let state: SweaSubmissionResultState = readCachedState(storage, key);
  const cleanup = getSweaPageKind(url) === "solving"
    ? observe(document, (observation) => {
        state = observation;
        writeCachedState(storage, key, observation);
        onObservation?.(observation);
      })
    : () => undefined;

  return { getState: () => state, cleanup };
}
