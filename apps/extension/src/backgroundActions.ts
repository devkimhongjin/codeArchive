import type { Capture } from "./types";
import type { CaptureSettings } from "./types";
import type { CaptureStore } from "./storage";
import { downloadFilename, exportCode } from "./export";
import { textDownloadUrl } from "./download";

export type CapturePreview = Omit<Capture, "sourceCode">;

export interface PopupLocalState {
  pendingCount: number;
  settings: Awaited<ReturnType<CaptureStore["getSettings"]>>;
  recentCaptures: CapturePreview[];
}

export interface PreparedDownload {
  filename: string;
  url: string;
}

export interface RelayRetryResult {
  ok: boolean;
  status: string | null;
  pendingCount: number;
  error?: "AUTO_SYNC_OFF" | "RELAY_UNAVAILABLE";
}

/** Builds one browser download request from the same rules as the manual action. */
export function prepareCaptureDownload(capture: Capture, settings: CaptureSettings): PreparedDownload | null {
  const filename = downloadFilename(capture, settings.downloadFilenameTemplate, {
    name: settings.name,
    nickname: settings.nickname,
    id: settings.accountId
  });
  const url = textDownloadUrl(exportCode(capture, settings.downloadHeader === true), filename.split(".").pop() ?? "txt");
  return url ? { filename, url } : null;
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

/**
 * Reuses the durable relay grant and waits for the requested drain so the popup
 * can report the resulting local queue state. User preferences are never
 * cleared merely because the transport is temporarily unavailable.
 */
export async function retryRelayConnection(
  store: Pick<CaptureStore, "getSettings" | "countPending">,
  requestDrain: () => Promise<void>
): Promise<RelayRetryResult> {
  const before = await store.getSettings();
  if (!before.autoSyncEnabled) {
    return { ok: false, status: before.relay?.status ?? null, pendingCount: await store.countPending(), error: "AUTO_SYNC_OFF" };
  }
  if (!before.relay || !["CONFIRMED", "OFFLINE", "RELAY_ERROR"].includes(before.relay.status)) {
    return { ok: false, status: before.relay?.status ?? null, pendingCount: await store.countPending(), error: "RELAY_UNAVAILABLE" };
  }
  await requestDrain();
  const [after, pendingCount] = await Promise.all([store.getSettings(), store.countPending()]);
  return { ok: after.relay?.status === "CONFIRMED", status: after.relay?.status ?? null, pendingCount };
}
