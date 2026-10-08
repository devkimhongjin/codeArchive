import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

test('only the own popup can submit a boolean, account/version-bound GitHub consent change', async () => {
  const id = 'test-extension';
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  let storageCalls = 0;
  const fakeChrome = {
    runtime: { id, onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    alarms: { clear: async () => true, create() {}, onAlarm: { addListener() {} } },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => { storageCalls++; return { 'codearchive-popup-relay-device-id': 'test-device-fixture' }; }, set: async () => {} } },
    tabs: { onUpdated: { addListener() {} } },
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  try {
    await import('../src/background'); assert.ok(listener);
    const sender = { id, frameId: 0, url: `chrome-extension://${id}/popup.html` };
    const message = { type: 'SET_GITHUB_AUTOMATION', enabled: true, accountId: '9', settingsVersion: 7 };
    const send = (from: unknown, payload: unknown = message) => new Promise<unknown>(done => listener!(payload, from, done));
    for (const from of [{ ...sender, id: 'foreign-extension' }, { ...sender, frameId: 1 }, { ...sender, url: 'https://jungol.co.kr/' }, { ...sender, url: `chrome-extension://${id}/history.html` }]) {
      assert.deepEqual(await send(from), { ok: false, error: 'UNAUTHORIZED' });
    }
    for (const invalid of [{ ...message, enabled: 'true' }, { ...message, settingsVersion: -1 }, { ...message, settingsVersion: 0.5 }, { ...message, accountId: 'not-an-account' }]) {
      assert.deepEqual(await send(sender, invalid), { ok: false, error: 'BAD_REQUEST' });
    }
    assert.equal(storageCalls, 0);
    // The worker serializes across popup instances, before even looking up a device.
    const first = send(sender); const second = send(sender);
    assert.deepEqual(await second, { ok: false, error: 'BUSY' });
    assert.deepEqual(await first, { ok: false, error: 'ACCOUNT_CHANGED' });
    assert.equal(storageCalls, 1);
  } finally { Object.assign(globalThis, previous); }
});
