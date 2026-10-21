import type { Capture, CaptureSettings } from './types';
import type { CaptureStore } from './storage';
import type { CaptureConnection } from './captureConnection';
import { storeCaptureOnServer } from './serverCapture';
import { recordRelayAttempt } from './relay';

export type QueueCaptureResult = { ok: boolean; created?: boolean; queued?: boolean; error?: string };
export interface QueuedCapture { accountId: string; capture: Capture }
export interface CaptureOutboxStore {
  enqueueCapture(capture: Capture, expectedAccountId: string): Promise<QueueCaptureResult>;
  listQueuedCaptures(accountId: string, limit?: number): Promise<QueuedCapture[]>;
  countQueuedCaptures(accountId: string): Promise<number>;
  acknowledgeQueuedCapture(accountId: string, captureId: string): Promise<void>;
}

/** Cached consent binds a submission locally even while the network is down.
 * Upload authority is checked separately against the live server session. */
export function captureOwner(settings: CaptureSettings): string | undefined {
  return settings.autoSyncEnabled && /^[1-9]\d{0,15}$/.test(settings.accountId ?? '') &&
    !!settings.relay && settings.relay.accountId === settings.accountId && ['CONFIRMED', 'OFFLINE', 'RELAY_ERROR', 'AUTH_EXPIRED'].includes(settings.relay.status)
    ? settings.accountId : undefined;
}

/** Who a new submission is queued for. Unlike upload authority, a missing or
 * pending grant does not drop the submission: a popup toggle whose grant
 * request failed leaves no relay, and the outbox rebuilds it from the
 * signed-in cookie before uploading. OFF, revocation and another account's
 * grant still refuse it. */
export function queueOwner(settings: CaptureSettings): string | undefined {
  const accountId = settings.accountId, relay = settings.relay;
  if (settings.autoSyncEnabled !== true || !accountId || !/^[1-9]\d{0,15}$/.test(accountId)) return undefined;
  if (!relay) return accountId;
  return relay.accountId === accountId && relay.status !== 'REVOCATION_PENDING' ? accountId : undefined;
}

export function queuedCapture(capture: Capture, accountId: string): QueuedCapture {
  // Never accept an owner or synchronization claim from the source page.
  const { syncAccountId: _owner, syncedAt: _syncedAt, ...payload } = capture;
  return { accountId, capture: { ...payload, syncAccountId: accountId, syncState: 'PENDING' } };
}

export function sameQueuedSubmission(left: Capture, right: Capture): boolean {
  return (['captureId', 'platform', 'problemNumber', 'title', 'problemUrl', 'language', 'sourceCode', 'result', 'observedAt', 'solvedAt'] as const)
    .every(key => left[key] === right[key]);
}

/** Acknowledge the durable local transaction before starting any network work. */
export async function retainCaptureForRetry(store: CaptureOutboxStore, capture: Capture, accountId: string, requestDrain: () => void): Promise<QueueCaptureResult> {
  const result = await store.enqueueCapture(capture, accountId);
  if (result.ok) {
    try { requestDrain(); } catch { /* The startup/minute alarm will retry. */ }
  }
  return result;
}

type Outbox = CaptureOutboxStore & Pick<CaptureStore, 'getSettings' | 'mutateRelayIfCurrent'>;

/** Only this dedicated queue is replayable. Legacy archives/history never enter
 * it. Keep the original capture ID and timestamps through grant renewal. */
export async function drainCaptureOutbox(store: Outbox, verifyConnection: () => Promise<CaptureConnection>, fetcher: typeof fetch = fetch): Promise<void> {
  // A missing grant is restored by verifyConnection below; queueOwner still
  // refuses OFF, revocation and another account's grant without any request.
  const initial = await store.getSettings(), accountId = captureOwner(initial) ?? queueOwner(initial);
  if (!accountId) return;
  const queued = await store.listQueuedCaptures(accountId, 10);
  if (!queued.length) return;
  const connection = await verifyConnection();
  if (connection.status !== 'READY' || connection.accountId !== accountId) {
    if (connection.status === 'LOGIN_REQUIRED') await recordRelayAttempt(store, initial, 'AUTH_EXPIRED');
    else if (connection.status === 'OFFLINE') await recordRelayAttempt(store, initial, 'OFFLINE');
    return;
  }
  for (const entry of queued) {
    const current = await store.getSettings();
    if (captureOwner(current) !== accountId || entry.accountId !== accountId) return;
    const result = await storeCaptureOnServer(store, entry.capture, fetcher, accountId);
    if (!result.ok) return; // No busy retry loop during an outage.
    await store.acknowledgeQueuedCapture(accountId, entry.capture.captureId);
  }
}
