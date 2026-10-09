import assert from 'node:assert/strict';
import test from 'node:test';
import { beginDashboardLogin, completeDashboardLogin, dashboardSender, DASHBOARD_LOGIN_ROUTE_KEY } from '../src/dashboardNavigation';
const nonce = '11111111-1111-4111-8111-111111111111';
const extensionId = 'oohlcmihldmfninmdcmanddfmhoonmdl';
const returned = 'https://codearchive-dashboard-beta.netlify.app/';
function fixture() {
  const session: Record<string, any> = { [DASHBOARD_LOGIN_ROUTE_KEY]: { dashboardTabId: 1, loginTabId: 2, loginNonce: nonce, expiresAt: 1000 } };
  const calls: any[] = [];
  const target: { id: number; windowId: number; url?: string } = { id: 1, windowId: 3 }; // Tab.url intentionally absent.
  let response: any = { ready: true, loginNonce: nonce };
  const api = {
    runtime: { id: extensionId, sendMessage: async (message: unknown) => { calls.push(['message', message]); return response; } },
    storage: { session: { get: async () => ({ ...session }), set: async (value: object) => { Object.assign(session, value); calls.push(['set']); }, remove: async (key: string) => { delete session[key]; calls.push(['forget']); } } },
    tabs: {
      get: async () => target, create: async (options: unknown) => { calls.push(['create', options]); return { id: 2 }; },
      update: async (id: number, options: unknown) => { calls.push(['update', id, options]); return { id }; },
      remove: async (id: number) => { calls.push(['remove', id]); }
    }, windows: { update: async (id: number, options: unknown) => { calls.push(['focus', id, options]); } }
  };
  return { api: api as unknown as typeof chrome, session, target, calls, respond: (value: unknown) => { response = value; } };
}
test('saves a login route before navigating to an already-authorized provider', async () => {
  const f = fixture(); await beginDashboardLogin(returned + 'api/oauth2/authorization/github', 1, nonce, f.api, 100);
  assert.deepEqual(f.calls.map(call => call[0]), ['create', 'set', 'update']);
  assert.deepEqual(f.calls[0], ['create', { url: 'about:blank' }]);
  assert.equal(f.session[DASHBOARD_LOGIN_ROUTE_KEY].loginNonce, nonce);
});
test('requires the initiating extension document but not optional sender.tab.url', () => {
  const sender = { id: extensionId, url: `chrome-extension://${extensionId}/dashboard.html`, frameId: 0, documentId: 'original', tab: { id: 1 } };
  assert.equal(dashboardSender(sender, extensionId), true);
  for (const other of [{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, documentId: undefined }, { ...sender, url: 'https://evil.test/' }, { ...sender, tab: { id: 1, url: 'https://evil.test/' } }]) assert.equal(dashboardSender(other, extensionId), false);
});
test('returns to and focuses the initiating extension document without tabs URL permission', async () => {
  const f = fixture(); assert.equal(await completeDashboardLogin(2, returned, f.api, 100), true);
  assert.deepEqual(f.calls.map(call => call[0]), ['message', 'update', 'focus', 'forget', 'remove']);
  assert.deepEqual(f.calls[1], ['update', 1, { active: true }]);
  assert.deepEqual(f.calls[4], ['remove', 2]);
  assert.equal(f.session[DASHBOARD_LOGIN_ROUTE_KEY], undefined);
});
test('never returns a stale route, another tab or another origin', async () => {
  for (const [id, url, now] of [[3, returned, 100], [2, 'https://evil.test/', 100], [2, returned, 1000]] as const) {
    const f = fixture(); assert.equal(await completeDashboardLogin(id, url, f.api, now), false); assert.deepEqual(f.calls, []);
  }
});
test('never focuses a navigated tab or a document that does not acknowledge its nonce', async () => {
  const f = fixture(); f.target.url = 'https://jungol.co.kr/'; assert.equal(await completeDashboardLogin(2, returned, f.api, 100), false); assert.deepEqual(f.calls, []);
  for (const response of [undefined, { ready: true, loginNonce: 'other' }]) {
    const missing = fixture(); missing.respond(response); assert.equal(await completeDashboardLogin(2, returned, missing.api, 100), false); assert.equal(missing.calls.length, 1);
  }
});
test('failure returns to the extension but never reports a successful login', async () => {
  const f = fixture(); assert.equal(await completeDashboardLogin(2, returned + '?authError=oauth', f.api, 100), true);
  assert.equal(f.calls[0][1].type, 'DASHBOARD_LOGIN_FAILED');
});
test('GitHub installation handoff copies only fixed result and numeric installation ID', async () => {
  const f = fixture(); await completeDashboardLogin(2, returned + '?githubInstall=success&installationId=12&code=secret&state=secret', f.api, 100);
  assert.equal(f.calls[0][1].returnQuery, 'githubInstall=success&installationId=12');
  assert.ok(!JSON.stringify(f.calls).includes('secret'));
});
test('duplicate Chrome update events complete a route only once', async () => {
  const f = fixture(); const result = await Promise.all([completeDashboardLogin(2, returned, f.api, 100), completeDashboardLogin(2, returned, f.api, 100)]);
  assert.deepEqual(result.sort(), [false, true]); assert.equal(f.calls.filter(call => call[0] === 'remove').length, 1);
});
