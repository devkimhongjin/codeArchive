const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWebLogin } = require('../src/web-login.cjs');
const { REMOTE_ORIGIN } = require('../src/policy.cjs');
function fixture(options = {}) {
  let opened, expiration, completed = 0, fetches = 0;
  const login = createWebLogin({
    openExternal: async url => { opened = new URL(url); },
    completed: async () => { completed++; }, setTimer: callback => { expiration = callback; return 1; }, clearTimer: () => {},
    fetch: async (url, input) => {
      fetches++;
      assert.equal(url, `${REMOTE_ORIGIN}/api/desktop-auth/exchange`);
      assert.equal(input.redirect, 'error'); assert.equal(input.credentials, 'include');
      const body = JSON.parse(input.body);
      assert.equal(createHash('sha256').update(body.verifier).digest('base64url'), opened.searchParams.get('challenge'));
      assert.equal(opened.href.includes(body.verifier), false);
      assert.equal(body.code, 'c'.repeat(43));
      return { status: 200 };
    }, ...options
  });
  const callback = () => `codearchive://auth/complete?state=${opened.searchParams.get('state')}&requestId=${'r'.repeat(43)}&code=${'c'.repeat(43)}`;
  return { login, callback, opened: () => opened, expire: () => expiration(), completed: () => completed, fetches: () => fetches };
}
test('opens browser immediately without a network request or intermediate login button; callback proves the native session', async () => {
  const f = fixture(); const result = f.login.start();
  assert.equal(f.opened().origin, REMOTE_ORIGIN); assert.equal(f.opened().pathname, '/api/desktop-auth/start');
  assert.equal(f.fetches(), 0); assert.equal(f.login.pending(), true);
  assert.equal(await f.login.receiveCompletion(f.callback()), true);
  assert.deepEqual(await result, { ok: true }); assert.equal(f.completed(), 1); assert.equal(f.login.pending(), false);
  assert.equal(await f.login.receiveCompletion(f.callback()), false); assert.equal(f.fetches(), 1);
});
test('foreign, malformed, duplicate, credential-bearing and wrong-state callbacks never exchange or replace pending login', async () => {
  const f = fixture(); const result = f.login.start(); const valid = f.callback();
  for (const url of [valid.replace('codearchive:', 'https:'), valid.replace('//auth/', '//evil/'), valid.replace('/complete', '/other'), valid + '&code=' + 'c'.repeat(43), valid + '&extra=1', valid + '#fragment', valid.replace('//auth/', '//user@auth/'), valid.replace(/state=[^&]+/, 'state=' + 'x'.repeat(43)), valid.replace('requestId=' + 'r'.repeat(43), 'requestId=bad')]) {
    assert.equal(await f.login.receiveCompletion(url), false);
  }
  assert.equal(f.fetches(), 0); assert.equal(f.login.pending(), true);
  await f.login.receiveCompletion(valid); await result;
});
test('overlapping login does not replace the active state; expiration permits a new attempt', async () => {
  const f = fixture(); const first = f.login.start(); const old = f.callback();
  await assert.rejects(f.login.start(), /웹브라우저/); f.expire(); await assert.rejects(first, /만료/);
  const second = f.login.start(); assert.equal(await f.login.receiveCompletion(old), false);
  await f.login.receiveCompletion(f.callback()); await second;
});
test('only one callback is exchanged even while the first request is in flight', async () => {
  let release, requests = 0;
  const f = fixture({ fetch: async () => { requests++; return new Promise(resolve => { release = resolve; }); } });
  const result = f.login.start(); const first = f.login.receiveCompletion(f.callback());
  assert.equal(await f.login.receiveCompletion(f.callback()), false);
  release({ status: 200 }); await first; await result; assert.equal(requests, 1);
});
test('cancelled OAuth returns a safe failure only for the matching native state', async () => {
  const f = fixture(); const result = f.login.start();
  assert.equal(await f.login.receiveCompletion('codearchive://auth/failed?state=' + 'x'.repeat(43)), false);
  assert.equal(await f.login.receiveCompletion('codearchive://auth/failed?state=' + f.opened().searchParams.get('state')), true);
  await assert.rejects(result, /실패했거나 취소/); assert.equal(f.fetches(), 0); assert.equal(f.login.pending(), false);
});
test('failed launch or forged native errors cannot expose URLs, proof or callback codes and allow retry', async () => {
  const f = fixture({ openExternal: async () => { throw Error('로그인 요청 https://example.test?verifier=secret'); } });
  await assert.rejects(f.login.start(), error => !error.message.includes('secret') && /연결 상태/.test(error.message));
  assert.equal(f.login.pending(), false);
  const g = fixture({ fetch: async () => { throw Error('로그인 요청 ?code=secret'); } });
  const result = g.login.start(); await g.login.receiveCompletion(g.callback());
  await assert.rejects(result, error => !error.message.includes('secret') && /연결 상태/.test(error.message));
  assert.equal(g.login.pending(), false);
});
test('rejected code never completes the app account and permits retry', async () => {
  for (const status of [401, 403, 410, 429, 503]) {
    const f = fixture({ fetch: async () => ({ status }) }); const result = f.login.start();
    await f.login.receiveCompletion(f.callback()); await assert.rejects(result, /유효하지/);
    assert.equal(f.completed(), 0); assert.equal(f.login.pending(), false);
  }
});
