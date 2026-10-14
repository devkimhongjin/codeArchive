import type { Capture, CaptureSettings } from './types';
import type { CaptureStore } from './storage';
import { relayCapture, recordRelayAttempt, fetchRecentServerCaptures } from './relay';

type SettingsStore = Pick<CaptureStore, 'getSettings' | 'mutateRelayIfCurrent'>;
const sameAccount = (left: CaptureSettings, right: CaptureSettings) => !!left.accountId && left.accountId === right.accountId &&
  left.relay?.secret === right.relay?.secret && left.relay?.generation === right.relay?.generation;

/** No solution queue or IndexedDB write; success requires the server receipt. */
export async function storeCaptureOnServer(store: SettingsStore, capture: Capture, fetcher: typeof fetch = fetch, expectedAccountId?: string): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  const settings = await store.getSettings();
  if (expectedAccountId !== undefined && settings.accountId !== expectedAccountId) return { ok: false, error: 'ACCOUNT_CHANGED' };
  if (!settings.accountId || settings.relay?.accountId !== settings.accountId) return { ok: false, error: 'LOGIN_REQUIRED' };
  let acknowledged = false;
  const checkedFetcher: typeof fetch = async (input, init) => {
    const response = await fetcher(input, init);
    if (response.ok) {
      const receipt = await response.clone().json() as { accepted?: unknown; captureId?: unknown; generation?: unknown };
      acknowledged = receipt.accepted === true && receipt.captureId === capture.captureId && receipt.generation === settings.relay?.generation;
    }
    return response;
  };
  const attempt = await relayCapture(capture, settings, checkedFetcher);
  const result = attempt === 'ACK' && !acknowledged ? 'RELAY_ERROR' : attempt;
  await recordRelayAttempt(store, settings, result);
  if (!sameAccount(settings, await store.getSettings())) return { ok: false, error: 'ACCOUNT_CHANGED' };
  return result === 'ACK' ? { ok: true, created: true } : { ok: false, error: result };
}

export async function loadPopupServerState(store: Pick<CaptureStore, 'getSettings'>, fetcher: typeof fetch = fetch) {
  const settings = await store.getSettings();
  const recentCaptures = await fetchRecentServerCaptures(settings, fetcher);
  const current = await store.getSettings();
  return { pendingCount: 0, syncedProblemCount: 0, settings: current, recentCaptures: sameAccount(settings, current) ? recentCaptures : [] };
}
