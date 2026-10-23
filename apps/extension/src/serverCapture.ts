import type { Capture, CaptureSettings } from './types';
import type { CaptureStore } from './storage';
import { relayCapture, recordRelayAttempt, fetchRecentServerCaptures } from './relay';

type SettingsStore = Pick<CaptureStore, 'getSettings' | 'mutateRelayIfCurrent'>;
const sameAccount = (left: CaptureSettings, right: CaptureSettings) => !!left.accountId && left.accountId === right.accountId &&
  left.relay?.secret === right.relay?.secret && left.relay?.generation === right.relay?.generation;

/** Sends one retained submission. Success requires the exact server receipt. */
export async function storeCaptureOnServer(store: SettingsStore, capture: Capture, fetcher: typeof fetch = fetch, expectedAccountId?: string): Promise<{ ok: boolean; created?: boolean; error?: string; detail?: string }> {
  const settings = await store.getSettings();
  if (expectedAccountId !== undefined && settings.accountId !== expectedAccountId) return { ok: false, error: 'ACCOUNT_CHANGED' };
  if (!settings.accountId || settings.relay?.accountId !== settings.accountId) return { ok: false, error: 'LOGIN_REQUIRED' };
  let acknowledged = false, detail: string | undefined;
  const checkedFetcher: typeof fetch = async (input, init) => {
    const response = await fetcher(input, init);
    if (response.ok) {
      const receipt = await response.clone().json() as { accepted?: unknown; captureId?: unknown; generation?: unknown };
      acknowledged = receipt.accepted === true && receipt.captureId === capture.captureId && receipt.generation === settings.relay?.generation;
    } else if (response.status >= 400 && response.status < 500) {
      // The server's validation message (never source code) explains a rejection.
      const body = await response.clone().json().catch(() => null) as { message?: unknown; error?: unknown } | null;
      const message = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : undefined;
      if (message) detail = message.slice(0, 200);
    }
    return response;
  };
  const attempt = await relayCapture(capture, settings, checkedFetcher);
  const result = attempt === 'ACK' && !acknowledged ? 'RELAY_ERROR' : attempt;
  await recordRelayAttempt(store, settings, result);
  if (!sameAccount(settings, await store.getSettings())) return { ok: false, error: 'ACCOUNT_CHANGED' };
  return result === 'ACK' ? { ok: true, created: true } : { ok: false, error: result, ...(result === 'REJECTED' && detail ? { detail } : {}) };
}

export async function loadPopupServerState(store: Pick<CaptureStore, 'getSettings'>, fetcher: typeof fetch = fetch) {
  const settings = await store.getSettings();
  let recentCaptures: Omit<Capture, 'sourceCode'>[] = [];
  let recentUnavailable = false;
  try { recentCaptures = await fetchRecentServerCaptures(settings, fetcher); }
  catch { recentUnavailable = true; }
  const current = await store.getSettings();
  const currentAccount = sameAccount(settings, current);
  // A recent-list outage is not a failed settings read or consent withdrawal.
  return { pendingCount: 0, syncedProblemCount: 0, settings: current, recentCaptures: currentAccount ? recentCaptures : [],
    ...(recentUnavailable && currentAccount ? { recentError: 'SERVER_UNAVAILABLE' as const } : {}) };
}
