import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

test('manual site sync accepts only the own submission list pages of each platform', async () => {
  const id = 'test-extension';
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const stored: Record<string, unknown> = {};
  const fakeChrome = {
    runtime: { id, getManifest: () => ({ version: '1.0.5' }), onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    storage: { session: { get: async (key: string) => ({ [key]: stored[key] }), set: async (value: Record<string, unknown>) => { Object.assign(stored, value); }, remove: async () => undefined } },
    alarms: { clear: async () => true, get: async () => undefined, create() {}, onAlarm: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  try {
    await import('../src/background');
    const send = (message: unknown, url: string, extra: Record<string, unknown> = {}) =>
      new Promise<unknown>(resolve => listener!(message, { id, frameId: 0, url, tab: { id: 3, url }, ...extra }, resolve));
    const status = { type: 'SITE_SYNC_STATUS', rows: [] };
    for (const url of ['https://jungol.co.kr/problem/1000', 'https://jungol.co.kr/account/9', 'https://example.com/account/9/submission',
      'https://swexpertacademy.com/main/code/problem/problemDetail.do', 'https://school.programmers.co.kr/learn/challenges']) {
      assert.deepEqual(await send(status, url), { ok: false, error: 'BAD_REQUEST' }, url);
    }
    assert.deepEqual(await send(status, 'https://jungol.co.kr/account/9/submission', { frameId: 2 }), { ok: false, error: 'BAD_REQUEST' }, 'frames are refused');
    assert.deepEqual(await send(status, 'https://jungol.co.kr/account/9/submission', { id: 'other-extension' }), { ok: false, error: 'BAD_REQUEST' });
    // A list page is accepted, but a malformed row or a capture from another platform is not.
    assert.deepEqual(await send({ type: 'SITE_SYNC_STATUS', rows: [{ submissionId: 'x', problemNumber: '1' }] }, 'https://jungol.co.kr/account/9/submission'), { ok: false, error: 'BAD_REQUEST' });
    assert.deepEqual(await send({ type: 'SITE_SYNC_REGISTER', capture: { platform: 'SWEA' } }, 'https://jungol.co.kr/account/9/submission'), { ok: false, error: 'BAD_REQUEST' });
    assert.deepEqual(await send({ type: 'SITE_SYNC_COMMIT', captureIds: 'x' }, 'https://school.programmers.co.kr/learn/courses/30/lessons/42576'), { ok: false, error: 'BAD_REQUEST' });
    // History candidates are matched only for the extension's own history page.
    const match = { type: 'HISTORY_SERVER_MATCH', platform: 'PROGRAMMERS', rows: [] };
    assert.deepEqual(await send(match, 'https://school.programmers.co.kr/learn/challenges'), { ok: false, error: 'BAD_REQUEST' });
    assert.deepEqual(await send({ ...match, platform: 'OTHER' }, `chrome-extension://${id}/history.html`), { ok: false, error: 'BAD_REQUEST' });
    assert.deepEqual(await send(match, `chrome-extension://${id}/history.html`), { ok: false, error: 'LOGIN_REQUIRED' });
    // An accepted page with valid input reaches the account check (no extension login here).
    assert.deepEqual(await send(status, 'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do'), { ok: false, error: 'LOGIN_REQUIRED' });
    // Jungol moves between pages without reloading, so the sender URL is the page the
    // content script was injected on. The tab's current address says which page is open.
    const list = 'https://jungol.co.kr/account/9/submission';
    const onTab = (frameUrl: string, tabUrl: string | undefined) => send(status, frameUrl, { tab: { id: 3, ...(tabUrl ? { url: tabUrl } : {}) } });
    assert.deepEqual(await onTab('https://jungol.co.kr/account/9', list), { ok: false, error: 'LOGIN_REQUIRED' }, 'entered the list from its summary page: reaches the account check');
    assert.deepEqual(await onTab('https://jungol.co.kr/', list), { ok: false, error: 'LOGIN_REQUIRED' });
    assert.deepEqual(await onTab(list, 'https://jungol.co.kr/account/9'), { ok: false, error: 'BAD_REQUEST' }, 'the user has since left the list');
    assert.deepEqual(await onTab(list, 'https://jungol.co.kr/problem/1000'), { ok: false, error: 'BAD_REQUEST' });
    assert.deepEqual(await onTab(list, undefined), { ok: false, error: 'LOGIN_REQUIRED' }, 'without a tab address the injected one is used');
    assert.deepEqual(await onTab('https://jungol.co.kr/account/9', 'https://example.com/account/9/submission'), { ok: false, error: 'BAD_REQUEST' }, 'origins must agree');
    assert.deepEqual(await onTab('https://example.com/x', list), { ok: false, error: 'BAD_REQUEST' });
  } finally { Object.assign(globalThis, previous); }
});
