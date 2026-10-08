import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCaptureStore } from '../src/storage';
import { setPopupGithubAutomation } from '../src/popupGithubAutomation';
import type { AccountSettings } from '../../dashboard/src/types';

const settings = (enabled = false): AccountSettings => ({ version: 7, name: 'keep-name', nickname: 'keep-nickname',
  copyHeader: true, downloadHeader: false, githubHeader: true, downloadFilenameTemplate: '{number}',
  gitPathTemplate: '{capture_ID}', lightTheme: 'github-light', darkTheme: 'dracula', autoSyncEnabled: true,
  githubAutoCommitEnabled: enabled, githubTargetConfigured: true, githubStatus: 'AVAILABLE',
  githubInstallationId: 42, githubOwner: 'owner', githubRepository: 'solutions', githubBranch: 'work', githubRootPath: 'code',
  communityPublicByDefault: false, communityDuplicateVisibility: 'memory', githubCommitMessageTemplate: 'keep {title}' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function fixture(enabled = false) {
  const store = new MemoryCaptureStore();
  await store.updateSettings({ accountId: '9', accountSettingsVersion: 7, autoSyncEnabled: true,
    githubAutoCommitEnabled: enabled, githubTargetConfigured: true,
    relay: { endpoint: '/api/relay/captures', secret: 'old-relay', accountId: '9', generation: 7, status: 'CONFIRMED' } });
  const calls: { path: string; init: RequestInit }[] = [];
  let server = settings(enabled);
  const hooks = new Map<string, () => Promise<Response> | Response>();
  const fetcher = (async (input, init = {}) => {
    const url = new URL(String(input)); const path = `${init.method ?? 'GET'} ${url.pathname}`;
    assert.equal(url.origin, 'https://codearchive-dashboard-beta.netlify.app');
    assert.equal(init.credentials, 'include'); assert.equal(init.redirect, 'error');
    calls.push({ path, init });
    if (hooks.has(path)) return hooks.get(path)!();
    if (path === 'GET /api/auth/me') return json({ id: 9, githubId: '123' });
    if (path === 'GET /api/settings') return json(server);
    if (path === 'GET /api/auth/csrf') return json({ headerName: 'X-XSRF-TOKEN', token: 'csrf-fixture' });
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-CodeArchive-Github-Id'), '123');
    assert.equal(headers.get('X-XSRF-TOKEN'), 'csrf-fixture');
    if (path === 'PUT /api/settings') {
      const body = JSON.parse(String(init.body));
      assert.deepEqual({ ...body, githubAutoCommitEnabled: server.githubAutoCommitEnabled }, server);
      server = { ...body, version: 8 }; return json(server);
    }
    if (path === 'POST /api/relay/grants') {
      assert.deepEqual(JSON.parse(String(init.body)), { deviceId: 'popup-device-fixture', generation: 8 });
      return json({ endpoint: '/api/relay/captures', generation: 8, secret: 'fresh-relay', expiresAt: '2099-01-01T00:00:00Z' });
    }
    throw new Error('Unexpected route');
  }) as typeof fetch;
  return { store, calls, hooks, fetcher, setServer: (value: AccountSettings) => { server = value; },
    run: (next = !enabled) => setPopupGithubAutomation(store, { enabled: next, accountId: '9', settingsVersion: 7 }, 'popup-device-fixture', fetcher) };
}

for (const enabled of [false, true]) test(`popup ${enabled ? 'OFF' : 'ON'} persists server consent, preserves other settings and renews only the same account relay`, async () => {
  const f = await fixture(enabled);
  assert.deepEqual(await f.run(), { ok: true, relayReady: true });
  const local = await f.store.getSettings();
  assert.equal(local.githubAutoCommitEnabled, !enabled); assert.equal(local.autoSyncEnabled, true);
  assert.equal(local.accountSettingsVersion, 8); assert.equal(local.relay?.generation, 8);
  assert.equal(local.relay?.secret, 'fresh-relay'); assert.equal(local.relay?.status, 'CONFIRMED');
  assert.equal(f.calls.filter(call => call.path === 'PUT /api/settings').length, 1);
});

test('missing target opens connection flow without settings writes or grants', async () => {
  const f = await fixture(); f.setServer({ ...settings(), githubTargetConfigured: false });
  assert.deepEqual(await f.run(), { ok: false, needsTarget: true });
  assert.deepEqual(f.calls.map(call => call.path), ['GET /api/auth/me', 'GET /api/settings']);
});
test('server account mismatch and stale local popup snapshots never mutate settings', async () => {
  const f = await fixture(); f.hooks.set('GET /api/auth/me', () => json({ id: 10, githubId: '456' }));
  assert.deepEqual(await f.run(), { ok: false, error: 'ACCOUNT_CHANGED' }); assert.equal(f.calls.length, 1);
  f.calls.length = 0;
  await f.store.updateSettings({ accountSettingsVersion: 8 });
  assert.deepEqual(await f.run(), { ok: false, error: 'ACCOUNT_CHANGED' }); assert.equal(f.calls.length, 0);
});
test('changed server version stops before CSRF and conditional PUT', async () => {
  const f = await fixture(); f.setServer({ ...settings(), version: 8 });
  assert.deepEqual(await f.run(), { ok: false, error: 'SETTINGS_CHANGED' }); assert.equal(f.calls.length, 2);
});
test('GitHub outage prevents ON but never blocks OFF consent withdrawal', async () => {
  const on = await fixture(); on.setServer({ ...settings(), githubStatus: 'PROVIDER_UNAVAILABLE' });
  assert.deepEqual(await on.run(), { ok: false, error: 'PROVIDER_UNAVAILABLE' }); assert.equal(on.calls.length, 2);
  const off = await fixture(true); off.setServer({ ...settings(true), githubStatus: 'PROVIDER_UNAVAILABLE' });
  assert.deepEqual(await off.run(), { ok: true, relayReady: true });
});
test('account switch during security token lookup blocks the write', async () => {
  const f = await fixture(); f.hooks.set('GET /api/auth/csrf', async () => {
    await f.store.updateSettings({ accountId: '10' }); return json({ headerName: 'X-XSRF-TOKEN', token: 'fixture' });
  });
  assert.deepEqual(await f.run(), { ok: false, error: 'ACCOUNT_CHANGED' }); assert.equal(f.calls.length, 3);
});
test('account switch while PUT is in flight cannot overwrite the new account or issue a grant', async () => {
  const f = await fixture(); f.hooks.set('PUT /api/settings', async () => {
    await f.store.updateSettings({ accountId: '10', accountSettingsVersion: 99 });
    return json({ ...settings(true), version: 8 });
  });
  assert.deepEqual(await f.run(), { ok: false, error: 'ACCOUNT_CHANGED' });
  assert.equal((await f.store.getSettings()).accountId, '10');
  assert.equal(f.calls.some(call => call.path === 'POST /api/relay/grants'), false);
});
test('late relay grant cannot replace a newer dashboard configuration', async () => {
  const f = await fixture(); f.hooks.set('POST /api/relay/grants', async () => {
    await f.store.updateSettings({ accountSettingsVersion: 9, relay: { endpoint: '/api/relay/captures', secret: 'dashboard-wins', accountId: '9', generation: 9, status: 'CONFIRMED' } });
    return json({ endpoint: '/api/relay/captures', generation: 8, secret: 'late', expiresAt: '2099-01-01' });
  });
  assert.deepEqual(await f.run(), { ok: false, error: 'ACCOUNT_CHANGED' });
  assert.equal((await f.store.getSettings()).relay?.secret, 'dashboard-wins');
});
test('settings conflicts are not retried and keep the previous local relay intact', async () => {
  const f = await fixture(); f.hooks.set('PUT /api/settings', () => json({}, 409));
  assert.deepEqual(await f.run(), { ok: false, error: 'SETTINGS_CHANGED' });
  assert.equal((await f.store.getSettings()).relay?.secret, 'old-relay');
  assert.equal(f.calls.filter(call => call.path === 'PUT /api/settings').length, 1);
});
test('uncertain PUT clears the possibly revoked bearer without a second server write', async () => {
  const f = await fixture(); f.hooks.set('PUT /api/settings', () => { throw new Error('network reset'); });
  assert.deepEqual(await f.run(), { ok: false, error: 'SAVE_UNCONFIRMED' });
  assert.equal((await f.store.getSettings()).relay, undefined);
  assert.equal(f.calls.filter(call => call.path === 'PUT /api/settings').length, 1);
});
test('grant failure reports saved settings separately and does not restore a revoked bearer', async () => {
  const f = await fixture(true); f.hooks.set('POST /api/relay/grants', () => json({}, 503));
  assert.deepEqual(await f.run(), { ok: true, relayReady: false, error: 'RELAY_REFRESH_REQUIRED' });
  const saved = await f.store.getSettings();
  assert.equal(saved.githubAutoCommitEnabled, false); assert.equal(saved.accountSettingsVersion, 8); assert.equal(saved.relay, undefined);
});
for (const endpoint of ['https://foreign.test/api/relay/captures', '/api/settings', '/api/relay/captures?key=untrusted', 'https://user:pass@codearchive-dashboard-beta.netlify.app/api/relay/captures']) {
  test(`unexpected relay endpoint is rejected: ${endpoint}`, async () => {
    const f = await fixture(); f.hooks.set('POST /api/relay/grants', () => json({ endpoint, generation: 8, secret: 'not-used', expiresAt: '2099-01-01' }));
    assert.equal((await f.run()).relayReady, false); assert.equal((await f.store.getSettings()).relay, undefined);
  });
}
test('expired or wrong-generation grant never becomes current', async () => {
  const f = await fixture(); f.hooks.set('POST /api/relay/grants', () => json({ endpoint: '/api/relay/captures', generation: 7, secret: 'not-used', expiresAt: '2000-01-01' }));
  assert.equal((await f.run()).relayReady, false); assert.equal((await f.store.getSettings()).relay, undefined);
});
test('unauthenticated session and untrusted CSRF header fail before any settings write', async () => {
  const anonymous = await fixture(); anonymous.hooks.set('GET /api/auth/me', () => json({}, 401));
  assert.deepEqual(await anonymous.run(), { ok: false, error: 'LOGIN_REQUIRED' });
  const f = await fixture(); f.hooks.set('GET /api/auth/csrf', () => json({ headerName: 'Authorization', token: 'untrusted' }));
  assert.deepEqual(await f.run(), { ok: false, error: 'SECURITY_TOKEN_ERROR' }); assert.equal(f.calls.length, 3);
});
