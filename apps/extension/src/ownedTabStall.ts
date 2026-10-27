/**
 * Jungol (and possibly other sites) stops answering list requests while the tab
 * is in the background. The extension cannot tell why, only that nothing moves,
 * so it watches the task's own counters and reacts when they stand still.
 */
export const OWNED_TAB_STALL_MS = 15_000;

export type StallTracker = { tabId: number; signature: string; since: number };

/** Counters that change only when the source page really advanced; null while no task is running. */
export function localHistoryProgressSignature(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const state = response as Record<string, unknown>;
  if (state.status !== "SCANNING" && state.status !== "IMPORTING") return null;
  const progress = state.progress && typeof state.progress === "object" ? state.progress as Record<string, unknown> : {};
  return JSON.stringify([state.status, state.completed, state.saved, state.duplicate, state.skipped,
    progress.phase, progress.rows, progress.pagesLoaded, progress.groupsExpanded,
    progress.historiesRead, progress.currentProblemNumber, progress.lastProgressAt]);
}

/** `stalled` once the same signature has been seen on the same tab for OWNED_TAB_STALL_MS. */
export function trackStall(previous: StallTracker | null, tabId: number, signature: string | null, now: number):
  { tracker: StallTracker | null; stalled: boolean } {
  if (signature === null) return { tracker: null, stalled: false };
  if (previous && previous.tabId === tabId && previous.signature === signature) {
    return { tracker: previous, stalled: now - previous.since >= OWNED_TAB_STALL_MS };
  }
  return { tracker: { tabId, signature, since: now }, stalled: false };
}
