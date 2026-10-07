const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWebLogin } = require('../src/web-login.cjs');
const { REMOTE_ORIGIN } = require('../src/policy.cjs');
test('web approval delivers an independent session with an S256 proof kept out of URLs', async () => {
  let challenge, opened, polls = 0, completed = false;
  const login = createWebLogin({ now: () => 1, sleep: async () => {}, openExternal: async url => { opened = url; }, completed: async () => { completed = true; },
    fetch: async (url, options) => {
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'include');
      const body = JSON.parse(options.body);
      if (url.endsWith('/requests')) { challenge = body.challenge; return { status: 200, json: async () => ({ requestId: 'a'.repeat(43), expiresIn: 100000 }) }; }
      assert.equal(createHash('sha256').update(body.verifier).digest('base64url'), challenge);
      assert.equal(opened, `${REMOTE_ORIGIN}/api/desktop-auth/authorize?requestId=${'a'.repeat(43)}`);
      return { status: ++polls === 1 ? 202 : 200 };
    }
  });
  assert.deepEqual(await login.start(), { ok: true }); assert.equal(completed, true); assert.equal(login.pending(), false);
});
test('overlapping logins cannot replace the in-flight session and failure permits retry', async () => {
  let release;
  const login = createWebLogin({ fetch: async () => new Promise(resolve => { release = resolve; }), openExternal: () => {}, completed: () => {} });
  const first = login.start(); await assert.rejects(login.start(), /웹브라우저에서/);
  release({ status: 503 }); await assert.rejects(first, /아직 적용/); assert.equal(login.pending(), false);
});
test('untrusted intent and errors never open a URL or expose request details', async () => {
  let opened = false;
  const login = createWebLogin({ fetch: async () => { throw Error('secret https://example.test/request?token=secret'); }, openExternal: () => { opened = true; }, completed: () => {} });
  await assert.rejects(login.start(), error => !error.message.includes('secret') && /완료하지 못했습니다/.test(error.message));
  const unsafe = createWebLogin({ fetch: async () => ({ status: 200, json: async () => ({ requestId: 'https://evil.test', expiresIn: 1000 }) }), openExternal: () => { opened = true; }, completed: () => {} });
  await assert.rejects(unsafe.start(), /유효한 로그인/); assert.equal(opened, false);
});
test('expired login resets state without completing', async () => {
  let time = 1;
  const login = createWebLogin({ now: () => time, sleep: async () => { time = 10002; }, fetch: async () => ({ status: 200, json: async () => ({ requestId: 'a'.repeat(43), expiresIn: 10000 }) }), openExternal: () => {}, completed: () => { throw Error('must not complete'); } });
  await assert.rejects(login.start(), /만료/); assert.equal(login.pending(), false);
});
