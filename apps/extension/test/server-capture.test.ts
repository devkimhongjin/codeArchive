import assert from 'node:assert/strict';
import test from 'node:test';
import { storeCaptureOnServer, loadPopupServerState, POPUP_WAKE_BUDGET_MS } from '../src/serverCapture';
import type { Capture, CaptureSettings } from '../src/types';
import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';
const capture = { captureId: '00000000-0000-4000-8000-000000000001', platform: 'JUNGOL', problemNumber: '1', title: 'T', language: 'Java',
  sourceCode: 'class X{}', observedAt: '2026-10-12T00:00:00.000Z', solvedAt: '2026-10-12T00:00:00.000Z', syncState: 'PENDING', result: 'ACCEPTED', problemUrl: 'https://jungol.co.kr/problem/1' } as Capture;
function setup() {
  let settings = { accountId: '1', autoSyncEnabled: true, relay: { accountId: '1', generation: 7, secret: 'synthetic-only', endpoint: PUBLIC_API_ORIGIN + '/api/relay/captures', status: 'CONFIRMED' } } as CaptureSettings;
  return { getSettings: async () => settings, mutateRelayIfCurrent: async (_relay: unknown, mutate: (value: CaptureSettings) => CaptureSettings) => { settings = mutate(settings); return { settings, applied: true }; }, replace: (value: CaptureSettings) => { settings = value; } };
}
const quickWake = { wakeBudgetMs: 20, wakeRetryMs: 1 };
test('new accepted solutions require a server acknowledgement and never use a solution store', async () => {
  const result = await storeCaptureOnServer(setup(), capture, (async () => new Response(JSON.stringify({ accepted: true, captureId: capture.captureId, generation: 7 }), { status: 200 })) as typeof fetch);
  assert.equal(result.ok, true);
});
test('network failure and missing login cannot claim successful storage', async () => {
  assert.equal((await storeCaptureOnServer(setup(), capture, (async () => { throw new Error('offline'); }) as typeof fetch)).ok, false);
  const store = setup(); store.replace({ autoSyncEnabled: true } as CaptureSettings);
  assert.equal((await storeCaptureOnServer(store, capture)).error, 'LOGIN_REQUIRED');
});

test('a different account after the click-time connection check cannot receive this capture', async () => {
  let requests = 0;
  const result = await storeCaptureOnServer(setup(), capture, (async () => { requests++; return new Response('{}'); }) as typeof fetch, '2');
  assert.equal(result.error, 'ACCOUNT_CHANGED'); assert.equal(requests, 0);
});
test('recent solutions use the server and discard unexpected source fields', async () => {
  const result = await loadPopupServerState(setup(), (async (url: URL) => {
    assert.equal(url.pathname, '/api/relay/recent');
    return new Response(JSON.stringify({ captures: [capture] }));
  }) as unknown as typeof fetch);
  assert.equal(result.recentCaptures.length, 1);
  assert.equal('sourceCode' in result.recentCaptures[0]!, false);
  assert.equal(result.recentCaptures[0]!.syncState, 'SYNCED');
});
test('an account switch while reading previews cannot disclose the previous account list', async () => {
  const store = setup();
  const result = await loadPopupServerState(store, (async () => { store.replace({ accountId: '2' } as CaptureSettings); return new Response(JSON.stringify({ captures: [capture] })); }) as typeof fetch);
  assert.deepEqual(result.recentCaptures, []);
});
test('a failed recent lookup preserves saved account, GitHub consent and relay without returning stale rows', async () => {
  const store=setup(), original=await store.getSettings();
  store.replace({...original,githubAutoCommitEnabled:true,githubTargetConfigured:true});
  const saved=await store.getSettings();
  for(const fetcher of [async()=>{throw new TypeError('offline')},async()=>new Response(null,{status:503})]) {
    const result=await loadPopupServerState(store,fetcher as typeof fetch,quickWake);
    assert.equal(result.settings,saved);assert.equal(await store.getSettings(),saved);
    assert.equal(result.recentError,'SERVER_UNAVAILABLE');assert.deepEqual(result.recentCaptures,[]);
  }
});
test('a failed old-account lookup cannot attach its error to a replacement account', async () => {
  const store=setup();
  const result=await loadPopupServerState(store,(async()=>{store.replace({accountId:'2'} as CaptureSettings);throw new TypeError('offline')}) as typeof fetch,quickWake);
  assert.equal(result.settings.accountId,'2');assert.equal(result.recentError,undefined);assert.deepEqual(result.recentCaptures,[]);
});
const recentReply = () => new Response(JSON.stringify({ captures: [capture] }));
test('the popup outlasts the longest recorded server start but stays inside the 30 seconds Chrome allows a fetch', () => {
  assert.ok(POPUP_WAKE_BUDGET_MS > 21_000 && POPUP_WAKE_BUDGET_MS < 30_000);
});
test('the popup reads recent solutions again while a sleeping server wakes', async () => {
  const replies: Array<() => Promise<Response>> = [async () => { throw new TypeError('connection reset'); }, async () => new Response(null, { status: 503 }), async () => recentReply()];
  let requests = 0;
  const result = await loadPopupServerState(setup(), (async () => replies[requests++]!()) as typeof fetch, { wakeBudgetMs: 500, wakeRetryMs: 1 });
  assert.equal(requests, 3); assert.equal(result.recentError, undefined); assert.equal(result.recentCaptures.length, 1);
});
test('the popup gives up an unanswered request at its deadline and aborts it', async () => {
  let signal: AbortSignal | null | undefined, requests = 0;
  const result = await loadPopupServerState(setup(), ((_url: URL, init?: RequestInit) => { requests++; signal = init?.signal; return new Promise<Response>(() => undefined); }) as unknown as typeof fetch, quickWake);
  assert.equal(result.recentError, 'SERVER_UNAVAILABLE'); assert.equal(requests, 1); assert.equal(signal?.aborted, true);
});
test('only a waking server is asked again: a refused grant or a malformed answer settles at once', async () => {
  for (const [reply, recentError] of [[() => new Response(null, { status: 401 }), undefined], [() => new Response(null, { status: 404 }), 'SERVER_UNAVAILABLE'], [() => new Response('{"captures":[{}]}'), 'SERVER_UNAVAILABLE']] as const) {
    let requests = 0;
    const result = await loadPopupServerState(setup(), (async () => { requests++; return reply(); }) as typeof fetch, { wakeBudgetMs: 200, wakeRetryMs: 1 });
    assert.equal(requests, 1); assert.equal(result.recentError, recentError); assert.deepEqual(result.recentCaptures, []);
  }
});
test('an offline browser reports the failure at once instead of waiting for a server it cannot reach', async () => {
  const had = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  try {
    let requests = 0;
    const result = await loadPopupServerState(setup(), (async () => { requests++; throw new TypeError('offline'); }) as typeof fetch, { wakeBudgetMs: 200, wakeRetryMs: 1 });
    assert.equal(requests, 1); assert.equal(result.recentError, 'SERVER_UNAVAILABLE');
  } finally { if (had) Object.defineProperty(navigator, 'onLine', had); else delete (navigator as unknown as { onLine?: boolean }).onLine; }
});
