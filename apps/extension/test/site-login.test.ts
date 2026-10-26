import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { checkSiteLogins, jungolLoginState, programmersLoginState, sweaLoginState } from '../src/siteLogin';

const SWEA_LIST = 'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do';
const SWEA_LOGIN = 'https://swexpertacademy.com/main/identity/anonymous/loginPage.do';

test('each platform page tells a signed-in browser from a visitor', () => {
  // Shapes taken from the live home page with and without the session cookie.
  assert.equal(jungolLoginState('<div class="ranking-cards"><a class="rank-card" href="/account/152511"><span>1</span></a></div>'), 'SIGNED_IN');
  assert.equal(jungolLoginState('<a class="signin" href="/auth/signin?next=Lw=="><button class="btn"><!---->로그인<!----></button></a>'), 'SIGNED_OUT');
  assert.equal(jungolLoginState('<html><body>점검 중</body></html>'), 'UNKNOWN');

  assert.deepEqual(sweaLoginState(SWEA_LOGIN, '<html></html>'), { state: 'SIGNED_OUT' });
  assert.deepEqual(sweaLoginState(SWEA_LIST, '<div class="my-login"><span class="name hidden-sm-down">\n  코더&amp;1 </span></div>'), { state: 'SIGNED_IN', name: '코더&1' });
  assert.deepEqual(sweaLoginState(SWEA_LIST, '<div class="my-login"></div>'), { state: 'SIGNED_IN' }, 'reaching the own list is enough');
  assert.deepEqual(sweaLoginState(SWEA_LIST, '', false), { state: 'UNKNOWN' }, 'an error page is not a sign-in');
  assert.deepEqual(sweaLoginState('https://swexpertacademy.com/main/main.do', ''), { state: 'UNKNOWN' });

  assert.equal(programmersLoginState('<div data-user-id="947840"></div><div data-user-id="947840"></div>'), 'SIGNED_IN');
  assert.equal(programmersLoginState('<div data-user-id=""></div><div data-user-id=""></div>'), 'SIGNED_OUT');
  assert.equal(programmersLoginState('<html></html>'), 'UNKNOWN');
});

test('the check reads every site with the browser cookies and survives a failing one', async () => {
  const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, credentials: init?.credentials });
    if (url.startsWith('https://jungol.co.kr/')) return new Response('<a href="/account/9">me</a>');
    if (url.startsWith('https://swexpertacademy.com/')) return Object.defineProperty(new Response('<form></form>'), 'url', { value: SWEA_LOGIN });
    throw new TypeError('network');
  }) as typeof fetch;
  const sites = await checkSiteLogins(fetcher);
  assert.deepEqual(sites.map(site => [site.platform, site.state]), [['JUNGOL', 'SIGNED_IN'], ['SWEA', 'SIGNED_OUT'], ['PROGRAMMERS', 'UNKNOWN']]);
  assert.ok(requests.every(request => request.credentials === 'include'));
  assert.ok(sites.every(site => site.loginUrl.startsWith('https://') && site.siteUrl.startsWith('https://')));
});

test('only the dashboard page may ask for the login status', async () => {
  const id = 'test-extension';
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const fakeChrome = {
    runtime: { id, getManifest: () => ({ version: '1.0.5' }), onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    storage: { session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
    alarms: { clear: async () => true, get: async () => undefined, create() {}, onAlarm: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, fetch: globalThis.fetch };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange, fetch: async () => new Response('') });
  try {
    await import('../src/background');
    const dashboard = { id, frameId: 0, documentId: 'doc', url: `chrome-extension://${id}/dashboard.html`, tab: { id: 4 } };
    const send = (sender: unknown) => new Promise<{ sites?: unknown[]; error?: string }>(resolve => listener!({ type: 'SITE_LOGIN_STATUS' }, sender, resolve as (value: unknown) => void));
    for (const sender of [{ ...dashboard, url: 'https://jungol.co.kr/' }, { ...dashboard, frameId: 1 }, { ...dashboard, id: 'other' },
      { ...dashboard, url: `chrome-extension://${id}/history.html` }]) assert.deepEqual(await send(sender), { error: 'UNAUTHORIZED' });
    assert.equal((await send(dashboard)).sites?.length, 3);
  } finally { Object.assign(globalThis, previous); }
});
