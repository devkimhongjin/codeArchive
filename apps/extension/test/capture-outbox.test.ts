import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDbCaptureStore, MemoryCaptureStore } from '../src/storage';
import { captureOwner, drainCaptureOutbox, retainCaptureForRetry } from '../src/captureOutbox';
import type { Capture, CaptureSettings } from '../src/types';
import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';

const capture: Capture = { captureId: '00000000-0000-4000-8000-000000000001', platform: 'JUNGOL', problemNumber: '1', title: 'Fixture',
  language: 'Java', sourceCode: 'class X {}', observedAt: '2026-10-14T00:00:00.000Z', solvedAt: '2026-10-14T00:00:00.000Z',
  syncState: 'PENDING', result: 'ACCEPTED', problemUrl: 'https://jungol.co.kr/problem/1' };
const settings: CaptureSettings = { accountId: '1', accountSettingsVersion: 7, autoSyncEnabled: true, autoDownloadEnabled: false,
  githubAutoCommitEnabled: true, githubTargetConfigured: true,
  relay: { accountId: '1', generation: 7, secret: 'synthetic-only', endpoint: PUBLIC_API_ORIGIN + '/api/relay/captures', status: 'CONFIRMED' } };
const ready = async () => ({ status: 'READY' as const, accountId: '1' });
const receipt = (id = capture.captureId, generation = 7) => new Response(JSON.stringify({ accepted: true, captureId: id, generation }));
async function memory() { const store = new MemoryCaptureStore(); await store.updateSettings(settings); return store; }

for (const mode of ['memory', 'indexeddb'] as const) {
  test(`${mode}: enqueue is account-bound, idempotent, immutable and separate from archives/history`, async () => {
    const store = mode === 'memory' ? new MemoryCaptureStore() : new IndexedDbCaptureStore({ indexedDb: new IDBFactory() });
    await store.updateSettings(settings);
    assert.deepEqual(await store.enqueueCapture({ ...capture, syncAccountId: 'foreign', syncState: 'SYNCED' }, '1'), { ok: true, created: true, queued: true });
    assert.deepEqual(await store.enqueueCapture(capture, '1'), { ok: true, created: false, queued: true });
    assert.equal((await store.enqueueCapture({ ...capture, sourceCode: 'changed' }, '1')).error, 'CAPTURE_CONFLICT');
    assert.equal((await store.enqueueCapture({ ...capture, historicalImport: true }, '1')).error, 'INVALID_CAPTURE');
    assert.equal((await store.enqueueCapture(capture, '2')).error, 'ACCOUNT_CHANGED');
    assert.equal(await store.countQueuedCaptures('1'), 1);
    assert.equal(await store.countQueuedCaptures('2'), 0);
    const entry = (await store.listQueuedCaptures('1'))[0]!;
    assert.equal(entry.capture.sourceCode, capture.sourceCode); assert.equal(entry.capture.syncAccountId, '1');
    assert.equal(entry.capture.syncState, 'PENDING');
    entry.capture.sourceCode = 'caller mutation';
    assert.equal((await store.listQueuedCaptures('1'))[0]!.capture.sourceCode, capture.sourceCode);
    assert.deepEqual(await store.listAll(), []);
    await store.acknowledgeQueuedCapture('2', capture.captureId);
    assert.equal(await store.countQueuedCaptures('1'), 1);
    await store.acknowledgeQueuedCapture('1', capture.captureId);
    assert.equal(await store.countQueuedCaptures('1'), 0);
  });
}

test('local acknowledgement does not wait for the server and a failed scheduling callback loses no source', async () => {
  const store = await memory();
  const result = await retainCaptureForRetry(store, capture, '1', () => { throw new Error('worker stopped'); });
  assert.equal(result.ok, true); assert.equal(result.queued, true);
  assert.equal(await store.countQueuedCaptures('1'), 1);
});

test('an aborted IndexedDB write never acknowledges storage or starts network work', async () => {
  const store = new IndexedDbCaptureStore({ indexedDb: new IDBFactory() }); await store.updateSettings(settings);
  const add = IDBObjectStore.prototype.add;
  let scheduled = false;
  IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
    if (this.name === 'pendingUploads') { this.transaction.abort(); throw new DOMException('full', 'QuotaExceededError'); }
    return add.apply(this, args);
  };
  try {
    await assert.rejects(retainCaptureForRetry(store, capture, '1', () => { scheduled = true; }), /full/);
    assert.equal(scheduled, false); assert.equal(await store.countQueuedCaptures('1'), 0);
  } finally { IDBObjectStore.prototype.add = add; }
});

test('IndexedDB survives a new worker/store instance and replays the exact ID/code after offline failure', async () => {
  const indexedDb = new IDBFactory();
  const first = new IndexedDbCaptureStore({ indexedDb });
  await first.updateSettings(settings);
  await retainCaptureForRetry(first, capture, '1', () => undefined);
  await drainCaptureOutbox(first, ready, async () => { throw new TypeError('offline'); });
  const restarted = new IndexedDbCaptureStore({ indexedDb });
  let writes = 0;
  await drainCaptureOutbox(restarted, ready, async (_url, init) => {
    writes++; const sent = JSON.parse(init!.body as string);
    assert.equal(sent.captureId, capture.captureId); assert.equal(sent.sourceCode, capture.sourceCode);
    assert.equal(sent.observedAt, capture.observedAt); assert.equal('syncAccountId' in sent, false);
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer synthetic-only');
    return receipt();
  });
  assert.equal(writes, 1); assert.equal(await restarted.countQueuedCaptures('1'), 0);
  assert.deepEqual(await restarted.listAll(), []);
});

test('upgrade from the legacy version preserves its records without making them replayable', async () => {
  // Build the old schema without retaining an open previous worker connection.
  const fresh = new IDBFactory(), request = fresh.open('codearchive-local', 3);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('captures', { keyPath: 'captureId' }).add(capture);
    db.createObjectStore('settings', { keyPath: 'id' }).add({ ...settings, id: 'settings' });
    db.createObjectStore('sweaProblemContexts', { keyPath: 'problemUrl' });
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close();
  const upgraded = new IndexedDbCaptureStore({ indexedDb: fresh });
  assert.equal((await upgraded.listAll()).length, 1);
  assert.equal(await upgraded.countQueuedCaptures('1'), 0);
  await upgraded.enqueueCapture({ ...capture, captureId: '00000000-0000-4000-8000-000000000002' }, '1');
  assert.equal(await upgraded.countQueuedCaptures('1'), 1);
});

test('OFF, pending revocation and missing/mismatched owner never authorize capture or replay', async () => {
  for (const patch of [{ autoSyncEnabled: false }, { relay: { ...settings.relay!, status: 'REVOCATION_PENDING' as const } },
    { accountId: undefined }, { relay: { ...settings.relay!, accountId: '2' } }]) {
    const store = await memory(); await store.enqueueCapture(capture, '1'); await store.updateSettings(patch);
    assert.equal(captureOwner(await store.getSettings()), undefined);
    assert.equal((await store.enqueueCapture(capture, '1')).ok, false);
    await drainCaptureOutbox(store, async () => { assert.fail('must not verify or transmit without consent'); });
    assert.equal(await store.countQueuedCaptures('1'), 1);
  }
});

test('expired login, offline verification and changed cookie account keep the queue without POSTs', async () => {
  for (const status of ['LOGIN_REQUIRED', 'OFFLINE', 'ACCOUNT_CHANGED', 'RECONNECT_REQUIRED'] as const) {
    const store = await memory(); await store.enqueueCapture(capture, '1');
    await drainCaptureOutbox(store, async () => ({ status }), async () => { assert.fail('not authorized'); });
    assert.equal(await store.countQueuedCaptures('1'), 1);
  }
  const store = await memory(); await store.enqueueCapture(capture, '1');
  await drainCaptureOutbox(store, async () => ({ status: 'READY', accountId: '2' }), async () => { assert.fail('wrong account'); });
  assert.equal(await store.countQueuedCaptures('1'), 1);
});

test('same account may renew an expired grant while replay preserves the original submission', async () => {
  const store = await memory(); await store.enqueueCapture(capture, '1');
  await store.updateSettings({ relay: { ...settings.relay!, status: 'AUTH_EXPIRED' } });
  // New submissions are retained even if the cached grant is temporarily expired.
  assert.equal((await store.enqueueCapture(capture, '1')).ok, true);
  await drainCaptureOutbox(store, async () => {
    await store.updateSettings({ relay: { ...settings.relay!, generation: 8, secret: 'renewed', status: 'CONFIRMED' } });
    return ready();
  }, async (_url, init) => {
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer renewed');
    return receipt(capture.captureId, 8);
  });
  assert.equal(await store.countQueuedCaptures('1'), 0);
});

test('malformed, wrong-ID/generation, error and unconfirmed receipts never remove the pending source', async () => {
  for (const response of [() => new Response('invalid JSON'), () => receipt('different'), () => receipt(capture.captureId, 8),
    () => new Response('{}'), () => new Response(null, { status: 503 }), () => new Response(null, { status: 401 })]) {
    const store = await memory(); await store.enqueueCapture(capture, '1');
    await drainCaptureOutbox(store, ready, async () => response());
    assert.equal(await store.countQueuedCaptures('1'), 1);
    assert.equal((await store.listQueuedCaptures('1'))[0]!.capture.sourceCode, capture.sourceCode);
  }
});

test('lost HTTP acknowledgement reuses the same server/job key after restart', async () => {
  const store = await memory(); await store.enqueueCapture(capture, '1');
  const saved = new Set<string>(), jobs = new Set<string>(); let requests = 0;
  const server: typeof fetch = async (_url, init) => {
    const id = JSON.parse(init!.body as string).captureId;
    saved.add(id); jobs.add(id); requests++;
    if (requests === 1) throw new TypeError('response lost after commit');
    return receipt(id);
  };
  await drainCaptureOutbox(store, ready, server);
  assert.equal(await store.countQueuedCaptures('1'), 1);
  await drainCaptureOutbox(store, ready, server);
  assert.equal(await store.countQueuedCaptures('1'), 0);
  assert.equal(saved.size, 1); assert.equal(jobs.size, 1); assert.equal(requests, 2);
});

test('switching accounts or turning OFF during verification stops a stale drain', async () => {
  for (const patch of [{ accountId: '2', relay: { ...settings.relay!, accountId: '2' } }, { autoSyncEnabled: false }]) {
    const store = await memory(); await store.enqueueCapture(capture, '1');
    await drainCaptureOutbox(store, async () => { await store.updateSettings(patch); return ready(); }, async () => { assert.fail('stale consent'); });
    assert.equal(await store.countQueuedCaptures('1'), 1);
    assert.equal(await store.countQueuedCaptures('2'), 0);
  }
});

test('a different account never sees/transmits prior pending source; returning to the owner resumes it', async () => {
  const store = await memory(); await store.enqueueCapture(capture, '1');
  await store.updateSettings({ accountId: '2', relay: { ...settings.relay!, accountId: '2' } });
  await drainCaptureOutbox(store, async () => { assert.fail('no queue for current account'); });
  assert.deepEqual(await store.listQueuedCaptures('2'), []);
  await store.updateSettings(settings); await drainCaptureOutbox(store, ready, async () => receipt());
  assert.equal(await store.countQueuedCaptures('1'), 0);
});

test('account change during an HTTP response cannot remove the old account record or alter the new relay', async () => {
  const store = await memory(); await store.enqueueCapture(capture, '1');
  await drainCaptureOutbox(store, ready, async () => {
    await store.updateSettings({ accountId: '2', relay: { ...settings.relay!, accountId: '2', secret: 'second' } });
    return receipt();
  });
  assert.equal(await store.countQueuedCaptures('1'), 1);
  assert.equal((await store.getSettings()).relay!.secret, 'second');
});

test('a failed first upload stops the batch and leaves later sources for the next alarm', async () => {
  const store = await memory(); await store.enqueueCapture(capture, '1');
  await store.enqueueCapture({ ...capture, captureId: '00000000-0000-4000-8000-000000000002' }, '1');
  let requests = 0;
  await drainCaptureOutbox(store, ready, async () => { requests++; return new Response(null, { status: 503 }); });
  assert.equal(requests, 1); assert.equal(await store.countQueuedCaptures('1'), 2);
});

for (const mode of ['memory', 'indexeddb'] as const) {
  test(`${mode}: a submission is queued while a failed popup toggle left no grant, and replay restores one first`, async () => {
    const store = mode === 'memory' ? new MemoryCaptureStore() : new IndexedDbCaptureStore({ indexedDb: new IDBFactory() });
    await store.updateSettings({ ...settings, relay: undefined });
    assert.equal(captureOwner(await store.getSettings()), undefined, 'there is no upload authority yet');
    assert.deepEqual(await store.enqueueCapture(capture, '1'), { ok: true, created: true, queued: true });

    // Restoration fails: the submission stays queued and nothing is posted.
    await drainCaptureOutbox(store, async () => ({ status: 'OFFLINE' }), async () => { assert.fail('no grant to upload with'); });
    assert.equal(await store.countQueuedCaptures('1'), 1);

    // The signed-in cookie issues a new grant, then the same submission uploads.
    let verified = 0;
    await drainCaptureOutbox(store, async () => {
      verified++;
      await store.updateSettings({ relay: { ...settings.relay!, secret: 'restored' } });
      return ready();
    }, async (_url, init) => {
      assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer restored');
      return receipt();
    });
    assert.equal(verified, 1);
    assert.equal(await store.countQueuedCaptures('1'), 0);
  });
}

test('a capture the server rejects no longer blocks later ones; a manual sync retries it and reports why', async () => {
  const store = await memory();
  const bad = { ...capture, captureId: '00000000-0000-4000-8000-0000000000aa', observedAt: '2026-10-14T00:00:00.000Z' };
  const good = { ...capture, captureId: '00000000-0000-4000-8000-0000000000bb', observedAt: '2026-10-14T00:00:01.000Z' };
  await store.enqueueCapture(bad, '1'); await store.enqueueCapture(good, '1');
  const posted: string[] = [];
  const server = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const id = JSON.parse(String(init!.body)).captureId as string; posted.push(id);
    return id === bad.captureId ? new Response(JSON.stringify({ message: 'languageKey does not match language' }), { status: 400 }) : receipt(id);
  };
  const first = await drainCaptureOutbox(store, ready, server);
  assert.deepEqual(first, { status: 'DONE', sent: 1, rejected: 1, remaining: 1, rejection: 'languageKey does not match language' });
  assert.deepEqual(posted, [bad.captureId, good.captureId], 'the later capture is sent after the rejected one');
  assert.equal((await store.getSettings()).relay?.status, 'CONFIRMED', 'a content rejection is not a connection failure');

  posted.length = 0;
  assert.deepEqual(await drainCaptureOutbox(store, ready, server), { status: 'IDLE', sent: 0, rejected: 0, remaining: 1 });
  assert.deepEqual(posted, [], 'automatic replay skips a rejected capture');

  const manual = await drainCaptureOutbox(store, ready, server, { manual: true });
  assert.deepEqual(posted, [bad.captureId], 'a manual sync retries it');
  assert.equal(manual.rejected, 1); assert.equal(manual.remaining, 1);
  assert.equal((await store.listQueuedCaptures('1', 10, { includeRejected: true }))[0]!.capture.sourceCode, bad.sourceCode, 'the rejected submission is kept, never dropped');
});

test('connection failures stop the queue and say why, without marking anything rejected', async () => {
  for (const [status, expected] of [[500, 'RELAY_ERROR'], [429, 'RELAY_ERROR']] as const) {
    const store = await memory(); await store.enqueueCapture(capture, '1');
    const summary = await drainCaptureOutbox(store, ready, async () => new Response('', { status }));
    assert.deepEqual(summary, { status: 'STOPPED', sent: 0, rejected: 0, remaining: 1, error: expected });
    assert.equal((await store.listQueuedCaptures('1')).length, 1, 'still eligible for automatic replay');
  }
  const store = await memory(); await store.enqueueCapture(capture, '1');
  assert.deepEqual(await drainCaptureOutbox(store, async () => ({ status: 'RECONNECT_REQUIRED' })), { status: 'RECONNECT_REQUIRED', sent: 0, rejected: 0, remaining: 1 });
});
