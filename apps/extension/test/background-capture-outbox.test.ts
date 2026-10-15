import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDbCaptureStore } from '../src/storage';
import { createCapture } from '../src/capture';
import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';

test('background acknowledges source before a stalled network, then startup/alarm replay without any popup', async () => {
  const id = 'outbox-extension', indexedDB = new IDBFactory();
  const session: Record<string, unknown> = { 'codearchive-connection-bootstrap-checked': true };
  const local: Record<string, unknown> = { 'codearchive-popup-relay-device-id': 'synthetic-device-id' };
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const startups: Array<() => void> = [], installs: Array<() => void> = [], alarms: Array<(alarm: { name: string }) => void> = [];
  const area = (records: Record<string, unknown>) => ({ get: async (key: string) => ({ [key]: records[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(records, values); }, remove: async (key: string) => { delete records[key]; } });
  const fakeChrome = { runtime: { id, onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} },
    onStartup: { addListener(callback: () => void) { startups.push(callback); } }, onInstalled: { addListener(callback: () => void) { installs.push(callback); } } },
    alarms: { clear: async () => true, create() {}, onAlarm: { addListener(callback: typeof alarms[number]) { alarms.push(callback); } } },
    storage: { session: area(session), local: area(local) }, tabs: { onUpdated: { addListener() {} } } };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, fetch: globalThis.fetch };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  const store = new IndexedDbCaptureStore({ indexedDb: indexedDB });
  const savedSettings = { version: 7, autoSyncEnabled: true, githubAutoCommitEnabled: true, githubTargetConfigured: true };
  let network: 'stalled' | 'online' | 'offline' = 'stalled', posts = 0, authReads = 0;
  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  const savedIds = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/auth/me') authReads++;
    if (network === 'stalled') { await stalled; throw new TypeError('network stopped'); }
    if (network === 'offline') throw new TypeError('offline');
    if (path === '/api/auth/me') return new Response(JSON.stringify({ id: 1, githubId: '1' }));
    if (path === '/api/settings') return new Response(JSON.stringify(savedSettings));
    if (path === '/api/relay/recent') return new Response(JSON.stringify({ captures: [] }));
    assert.equal(path, '/api/relay/captures'); assert.equal(init?.method, 'POST');
    posts++; const payload = JSON.parse(init!.body as string);
    assert.equal('syncAccountId' in payload, false); savedIds.add(payload.captureId);
    return new Response(JSON.stringify({ accepted: true, captureId: payload.captureId, generation: 7 }));
  };
  const until = async (predicate: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail('background work did not settle');
  };
  try {
    await import('../src/background'); await new Promise(resolve => setTimeout(resolve, 10));
    await store.updateSettings({ accountId: '1', accountSettingsVersion: 7, ...savedSettings,
      relay: { accountId: '1', generation: 7, secret: 'synthetic', endpoint: PUBLIC_API_ORIGIN + '/api/relay/captures', status: 'CONFIRMED' } });
    const sender = { id, frameId: 0, tab: { id: 8, url: 'https://jungol.co.kr/problem/1' }, url: 'https://jungol.co.kr/problem/1' };
    const send = (message: unknown, from: unknown = sender) => new Promise<unknown>(resolve => listener!(message, from, resolve));
    const capture = createCapture({ platform: 'JUNGOL', problemNumber: '1', title: 'Fixture', problemUrl: sender.url, language: 'Java', sourceCode: 'class X {}', result: 'ACCEPTED' })!;
    assert.ok(capture);
    assert.deepEqual(await send({ type: 'CHECK_CAPTURE_OWNER', platform: 'JUNGOL' }), { status: 'READY', accountId: '1' });
    const result = await send({ type: 'STORE_CAPTURE', capture, expectedAccountId: '1' });
    assert.deepEqual(result, { ok: true, created: true, queued: true });
    assert.equal(await new IndexedDbCaptureStore({ indexedDb: indexedDB }).countQueuedCaptures('1'), 1);
    assert.equal(posts, 0);
    // Repeated messages/alarm wakes cannot overwrite or concurrently transmit it.
    assert.deepEqual(await send({ type: 'STORE_CAPTURE', capture, expectedAccountId: '1' }), { ok: true, created: false, queued: true });
    alarms.forEach(callback => callback({ name: 'codearchive-relay-drain' }));
    assert.equal(await store.countQueuedCaptures('1'), 1);
    await until(() => authReads > 0); release();
    await until(async () => (await store.getSettings()).relay?.status === 'OFFLINE');
    assert.equal(await store.countQueuedCaptures('1'), 1);
    assert.deepEqual(await send({ type: 'STORE_CAPTURE', capture, expectedAccountId: '1' }, { ...sender, id: 'foreign' }), { ok: false, error: 'INVALID_CAPTURE' });
    network = 'online'; startups.forEach(callback => callback());
    await until(async () => await store.countQueuedCaptures('1') === 0);
    assert.equal(posts, 1); assert.equal(savedIds.size, 1);
    // A later outage is recovered solely by the minute alarm.
    network = 'offline';
    const second = { ...capture, captureId: '00000000-0000-4000-8000-000000000002' };
    assert.deepEqual(await send({ type: 'STORE_CAPTURE', capture: second, expectedAccountId: '1' }), { ok: true, created: true, queued: true });
    await until(async () => (await store.getSettings()).relay?.status === 'OFFLINE');
    network = 'online'; alarms.forEach(callback => callback({ name: 'codearchive-relay-drain' }));
    await until(async () => await store.countQueuedCaptures('1') === 0);
    assert.equal(posts, 2); assert.equal(savedIds.size, 2); assert.equal(installs.length, 1);
  } finally { release(); Object.assign(globalThis, previous); }
});
