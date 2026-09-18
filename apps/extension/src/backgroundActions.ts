import type { Capture } from "./types";
import type { CaptureStore } from "./storage";

export type CapturePreview = Omit<Capture, "sourceCode">;

export interface PopupLocalState {
  pendingCount: number;
  settings: Awaited<ReturnType<CaptureStore["getSettings"]>>;
  recentCaptures: CapturePreview[];
}

/**
 * Commits the accepted solution locally before scheduling any remote work.
 * `requestRelayDrain` deliberately returns void so a stalled network request
 * can never delay the content script's durable-storage acknowledgement.
 */
export async function storeCaptureLocalFirst(
  store: Pick<CaptureStore, "putCapture">,
  capture: Capture,
  requestRelayDrain: () => void
): Promise<{ created: boolean }> {
  const result = await store.putCapture(capture);
  if (result.created) {
    try {
      requestRelayDrain();
    } catch {
      // The capture is already durable. The minute alarm can retry remote work.
    }
  }
  return result;
}

/** Returns only local IndexedDB state; remote status enrichment is separate. */
export async function loadPopupLocalState(
  store: Pick<CaptureStore, "countPending" | "getSettings" | "listAll">
): Promise<PopupLocalState> {
  const [pendingCount, settings, recentCaptures] = await Promise.all([
    store.countPending(),
    store.getSettings(),
    store.listAll(3)
  ]);
  return {
    pendingCount,
    settings,
    recentCaptures: recentCaptures.map(({ sourceCode: _sourceCode, ...preview }) => preview)
  };
}
