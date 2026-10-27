import type { Capture, CaptureSettings } from './types';
import type { CaptureStore } from './storage';
import type { CaptureConnection } from './captureConnection';
import { storeCaptureOnServer } from './serverCapture';
import { recordRelayAttempt } from './relay';

export type QueueCaptureResult = { ok: boolean; created?: boolean; queued?: boolean; error?: string };
/** rejectedAt: the server refused this content; automatic replay skips it, a manual sync retries it. */
export interface QueuedCapture { accountId: string; capture: Capture; rejectedAt?: string }
export type ListQueuedOptions = { includeRejected?: boolean };
export interface CaptureOutboxStore {
  enqueueCapture(capture: Capture, expectedAccountId: string): Promise<QueueCaptureResult>;
  listQueuedCaptures(accountId: string, limit?: number, options?: ListQueuedOptions): Promise<QueuedCapture[]>;
  markQueuedCaptureRejected(accountId: string, captureId: string, at: string): Promise<void>;
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
export type DrainSummary = {
  /** IDLE: nothing to send; DONE: every attempted item was settled; STOPPED: a connection problem paused the queue. */
  status: 'IDLE' | 'DONE' | 'STOPPED' | 'NO_ACCOUNT' | Exclude<CaptureConnection['status'], 'READY'>;
  sent: number; rejected: number; remaining: number; error?: string; rejection?: string;
};
export type DrainOptions = { manual?: boolean };

export async function drainCaptureOutbox(store: Outbox, verifyConnection: () => Promise<CaptureConnection>, fetcher: typeof fetch = fetch,
  options: DrainOptions = {}): Promise<DrainSummary> {
  // A missing grant is restored by verifyConnection below; queueOwner still
  // refuses OFF, revocation and another account's grant without any request.
  const initial = await store.getSettings(), accountId = captureOwner(initial) ?? queueOwner(initial);
  if (!accountId) return { status: 'NO_ACCOUNT', sent: 0, rejected: 0, remaining: 0 };
  // Automatic replay skips content the server already refused, so one bad
  // capture cannot hold back every later one. A manual sync retries them all.
  const list = () => store.listQueuedCaptures(accountId, options.manual ? 100 : 10, { includeRejected: options.manual === true });
  const remaining = () => store.countQueuedCaptures(accountId);
  const queued = await list();
  if (!queued.length) return { status: 'IDLE', sent: 0, rejected: 0, remaining: await remaining() };
  const connection = await verifyConnection();
  if (connection.status !== 'READY' || connection.accountId !== accountId) {
    if (connection.status === 'LOGIN_REQUIRED') await recordRelayAttempt(store, initial, 'AUTH_EXPIRED');
    else if (connection.status === 'OFFLINE') await recordRelayAttempt(store, initial, 'OFFLINE');
    return { status: connection.status === 'READY' ? 'ACCOUNT_CHANGED' : connection.status, sent: 0, rejected: 0, remaining: await remaining() };
  }
  let sent = 0, rejected = 0, rejection: string | undefined;
  for (const entry of queued) {
    const current = await store.getSettings();
    if (captureOwner(current) !== accountId || entry.accountId !== accountId) return { status: 'STOPPED', sent, rejected, remaining: await remaining(), error: 'ACCOUNT_CHANGED' };
    const result = await storeCaptureOnServer(store, entry.capture, fetcher, accountId);
    if (result.ok) { await store.acknowledgeQueuedCapture(accountId, entry.capture.captureId); sent++; continue; }
    if (result.error === 'REJECTED') { await store.markQueuedCaptureRejected(accountId, entry.capture.captureId, new Date().toISOString()); rejected++; rejection ??= result.detail; continue; }
    // No busy retry loop during an outage.
    return { status: 'STOPPED', sent, rejected, remaining: await remaining(), ...(result.error ? { error: result.error } : {}), ...(rejection ? { rejection } : {}) };
  }
  return { status: 'DONE', sent, rejected, remaining: await remaining(), ...(rejection ? { rejection } : {}) };
}
