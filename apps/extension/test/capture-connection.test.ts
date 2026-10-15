import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreCaptureConnection, restoreCaptureSession } from '../src/captureConnection';
import type { Capture, CaptureSettings } from '../src/types';
import { storeCaptureOnServer } from '../src/serverCapture';
import { submissionNotice } from '../src/submissionNotice';
import { parseHTML } from 'linkedom';
import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';
const device = 'synthetic-device-123456789';
const initial = (): CaptureSettings => ({ accountId: '1', accountSettingsVersion: 7, autoSyncEnabled: true, autoDownloadEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: true,
  relay: { accountId: '1', generation: 7, secret: 'synthetic-old', endpoint: PUBLIC_API_ORIGIN + '/api/relay/captures', status: 'CONFIRMED' } });
function fixture(value = initial()) {
  let settings = value; const calls: string[] = [];
  let hook: (path: string) => void = () => undefined;
  const replies: Record<string, unknown | number> = {
    '/api/auth/me': { id: 1, githubId: '123' }, '/api/settings': { version: 7, autoSyncEnabled: true, githubAutoCommitEnabled: false, githubTargetConfigured: true },
    '/api/relay/recent': { captures: [] }, '/api/auth/csrf': { headerName: 'X-XSRF-TOKEN', token: 'synthetic-csrf' },
    '/api/relay/grants': { endpoint: '/api/relay/captures', secret: 'synthetic-new', generation: 7, expiresAt: new Date(Date.now() + 60000).toISOString() },
  };
  const fetcher = (async (input, init) => {
    const url = new URL(String(input)); const path = url.pathname; calls.push(path); hook(path);
    assert.equal(url.origin, PUBLIC_API_ORIGIN); assert.equal(init?.credentials, 'include'); assert.equal(init?.redirect, 'error');
    const payload = replies[path]; if (payload === 'offline') throw new TypeError('offline');
    if (typeof payload === 'number') return new Response(null, { status: payload });
    return new Response(JSON.stringify(payload));
  }) as typeof fetch;
  const store = { getSettings: async () => settings, mutateSettings: async (mutate: (value: CaptureSettings) => CaptureSettings) => settings = mutate(settings) };
  return { store, fetcher, calls, replies, settings: () => settings, replace: (value: CaptureSettings) => { settings = value; }, hook: (next: typeof hook) => { hook = next; } };
}
test('existing authenticated cookie and durable grant reconnect without rotation across new service instances', async () => {
  const f = fixture(); const original = f.settings();
  assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'READY');
  assert.equal(await restoreCaptureConnection({ ...f.store }, device, f.fetcher), 'READY');
  assert.equal(f.settings(), original); assert.equal(f.calls.includes('/api/relay/grants'), false);
});
test('initial session confirmation has a startup budget without lengthening grant or relay requests', async t => {
  const budgets:number[]=[];
  t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{budgets.push(milliseconds);return new AbortController().signal});
  const f=fixture(), original=f.settings();
  assert.equal(await restoreCaptureConnection(f.store,device,f.fetcher),'READY');
  assert.deepEqual(budgets,[30_000,8000,8000]);
  assert.equal(f.settings(),original);assert.equal(f.calls.includes('/api/relay/grants'),false);
});
test('a stale grant is renewed only using a live same-account cookie and matching server settings', async () => {
  const f = fixture(); f.replies['/api/relay/recent'] = 401;
  assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'READY');
  assert.equal(f.settings().relay?.secret, 'synthetic-new');
  assert.equal(f.calls.filter(path => path === '/api/relay/grants').length, 1);
});

test('durable local opt-out remains off even if server consent is still enabled', async () => {
  for (const relay of [undefined, initial().relay]) {
    const f = fixture({ ...initial(), autoSyncEnabled: false, relay }); const original = f.settings();
    assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'RECONNECT_REQUIRED');
    assert.equal(f.settings(), original); assert.deepEqual(f.calls, []);
    const result = await storeCaptureOnServer({ ...f.store, mutateRelayIfCurrent: async () => ({ settings: f.settings(), applied: false }) },
      { captureId: 'synthetic-disabled' } as Capture, f.fetcher, '1');
    assert.equal(result.ok, false); assert.deepEqual(f.calls, []);
  }
});

test('a pending grant is confirmed with cookie authentication before READY and can then store', async () => {
  const f = fixture({ ...initial(), relay: { ...initial().relay!, status: 'PENDING' } });
  const connection = await restoreCaptureSession(f.store, device, f.fetcher);
  assert.deepEqual(connection, { status: 'READY', accountId: '1' });
  assert.equal(f.settings().relay?.status, 'CONFIRMED');
  assert.equal(f.calls.includes('/api/relay/recent'), false);
  assert.equal(f.calls.filter(path => path === '/api/relay/grants').length, 1);
  const capture = { captureId: 'synthetic-confirmed' } as Capture;
  let uploads = 0;
  const result = await storeCaptureOnServer({ ...f.store, mutateRelayIfCurrent: async (relay, mutate) => {
    if (f.settings().relay?.secret !== relay.secret) return { settings: f.settings(), applied: false };
    return { settings: await f.store.mutateSettings(mutate), applied: true };
  } }, capture, (async (_input, init) => {
    uploads++; assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-new');
    return new Response(JSON.stringify({ accepted: true, captureId: capture.captureId, generation: 7 }));
  }) as typeof fetch, connection.accountId);
  assert.equal(result.ok, true); assert.equal(uploads, 1);
});
test('401 requires login and outages retain all durable settings without revocation or a new grant', async () => {
  for (const value of [401, 403, 503, 'offline']) {
    const f = fixture(); const original = f.settings(); f.replies['/api/auth/me'] = value;
    assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), value === 401 ? 'LOGIN_REQUIRED' : value === 403 ? 'RECONNECT_REQUIRED' : 'OFFLINE');
    assert.equal(f.settings(), original); assert.deepEqual(f.calls, ['/api/auth/me']);
  }
});
test('a different browser account cannot adopt or upload the original account connection', async () => {
  const f = fixture(); f.replies['/api/auth/me'] = { id: 2, githubId: '456' };
  assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'ACCOUNT_CHANGED'); assert.equal(f.settings().accountId, '1');
  assert.equal(f.calls.includes('/api/settings'), false);
});

test('READY carries the validated account rather than an identity read after restoration', async () => {
  const f = fixture(); const connection = await restoreCaptureSession(f.store, device, f.fetcher);
  f.replace({ ...initial(), accountId: '2', relay: { ...initial().relay!, accountId: '2' } });
  assert.deepEqual(connection, { status: 'READY', accountId: '1' });
  f.replies['/api/auth/me'] = 401;
  assert.deepEqual(await restoreCaptureSession(f.store, device, f.fetcher), { status: 'LOGIN_REQUIRED' });
});
test('logout, relay revocation, or a newer configuration during renewal wins over its stale response', async () => {
  for (const replacement of [{ ...initial(), accountId: undefined, relay: undefined }, { ...initial(), relay: { ...initial().relay!, status: 'REVOCATION_PENDING' as const } }, { ...initial(), accountSettingsVersion: 8 }]) {
    const f = fixture(); f.replies['/api/relay/recent'] = 401;
    f.hook(path => { if (path === '/api/relay/grants') f.replace(replacement); });
    assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'ACCOUNT_CHANGED'); assert.equal(f.settings(), replacement);
  }
});
test('invalid grant origins, CSRF headers, stale versions and disabled consent fail closed', async () => {
  for (const [path, reply] of [
    ['/api/relay/grants', { endpoint: 'https://evil.example/api/relay/captures', secret: 'fake', generation: 7, expiresAt: new Date(Date.now()+60000).toISOString() }],
    ['/api/auth/csrf', { headerName: 'Authorization', token: 'fake' }],
    ['/api/settings', { version: 6, autoSyncEnabled: true }], ['/api/settings', { version: 7, autoSyncEnabled: false }],
  ] as const) {
    const f = fixture(); const original = f.settings(); f.replies['/api/relay/recent'] = 401; f.replies[path] = reply;
    assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'RECONNECT_REQUIRED'); assert.equal(f.settings(), original);
  }
});

test('relay renewal does not claim that an older export/theme snapshot was refreshed', async () => {
  const f = fixture(); f.replies['/api/settings'] = { version: 8, autoSyncEnabled: true };
  f.replies['/api/relay/grants'] = { ...(f.replies['/api/relay/grants'] as object), generation: 8 };
  assert.equal(await restoreCaptureConnection(f.store, device, f.fetcher), 'READY');
  assert.equal(f.settings().relay?.generation, 8); assert.equal(f.settings().accountSettingsVersion, 7);
});
test('submission notice is source-free, distinguishes login/offline and supports retry/dashboard without duplication', () => {
  const { document } = parseHTML('<html><body><button id="submit">사이트 제출</button></body></html>'); let opened = 0, retried = 0;
  const open = () => { opened++; }, retry = () => { retried++; };
  submissionNotice(document, 'LOGIN_REQUIRED', open, retry); submissionNotice(document, 'LOGIN_REQUIRED', open, retry);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1); assert.match(document.body.textContent!, /GitHub 로그인이 필요/);
  const buttons = document.querySelectorAll<HTMLButtonElement>('aside button'); buttons[0]!.click(); buttons[1]!.click(); assert.equal(opened, 1); assert.equal(retried, 1);
  submissionNotice(document, 'OFFLINE', open, retry); assert.match(document.body.textContent!, /서버에 연결할 수 없습니다/);
  submissionNotice(document, 'READY', open, retry); assert.equal(document.querySelector('[role="alert"]'), null); assert.ok(document.getElementById('submit'));
});
