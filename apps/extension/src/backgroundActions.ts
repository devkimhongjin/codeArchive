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
