import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardBridge } from '../src/bridge';
import { MemoryCaptureStore } from '../src/storage';
import { createCapture } from '../src/capture';
import { dashboardExternalUrl, dashboardLoginReturn, dashboardReturnQuery } from '../src/dashboardNavigation';
const id = 'oohlcmihldmfninmdcmanddfmhoonmdl';
const url = `chrome-extension://${id}/dashboard.html`;
const sender = { id, url, frameId: 0, documentId: 'dashboard-1', tab: { id: 1, url } };
test('own management tab reads existing captures without app pairing and fences capabilities by document', async () => {
  const store = new MemoryCaptureStore();
  const capture = createCapture({ platform: 'SWEA', problemNumber: '1', title: 'test', problemUrl: 'https://example.test/1', language: 'Java', sourceCode: 'class A {}', result: 'ACCEPTED' });
  assert.ok(capture); await store.putCapture(capture);
  const bridge = new DashboardBridge(store);
  const connection = await bridge.handleExtensionMessage({ type: 'CONNECT' }, sender, id);
  assert.ok('capability' in connection);
  const message = { type: 'GET_LOCAL_ARCHIVE', capability: connection.capability };
  const result = await bridge.handleExtensionMessage(message, sender, id);
  assert.equal('captures' in result && result.captures.length, 1);
  assert.equal(await store.countPending(), 1);
  for (const other of [{ ...sender, id: 'another' }, { ...sender, frameId: 1 }, { ...sender, documentId: 'dashboard-2' }, { ...sender, url: url.replace('dashboard', 'popup') }, { ...sender, url: 'https://jungol.co.kr/', tab: { id: 1, url: 'https://jungol.co.kr/' } }]) {
    assert.deepEqual(await bridge.handleExtensionMessage(message, other, id), { error: 'UNAUTHORIZED' });
  }
  const restarted = new DashboardBridge(store);
  assert.deepEqual(await restarted.handleExtensionMessage(message, sender, id), { error: 'UNAUTHORIZED' });
  assert.ok('capability' in await restarted.handleExtensionMessage({ type: 'CONNECT' }, sender, id));
});
test('login navigation pins provider URLs and copies no OAuth secrets into the extension', () => {
  assert.equal(dashboardExternalUrl('/api/oauth2/authorization/github'), 'https://codearchive-dashboard-beta.netlify.app/api/oauth2/authorization/github');
  assert.ok(dashboardExternalUrl('https://github.com/apps/codearchive/installations/new?state=public-state'));
  for (const unsafe of ['https://evil.test/', '//evil.test/api/oauth2/authorization/github', 'https://name:secret@github.com/apps/codearchive/installations/new', '/api/oauth2/authorization/github?redirect=https://evil.test']) assert.equal(dashboardExternalUrl(unsafe), null);
  assert.equal(dashboardLoginReturn('https://codearchive-dashboard-beta.netlify.app/'), true);
  assert.equal(dashboardLoginReturn('https://evil.test/'), false);
  assert.equal(dashboardReturnQuery('https://codearchive-dashboard-beta.netlify.app/?githubInstall=success&installationId=12&code=private&state=private'), 'githubInstall=success&installationId=12');
});

test('own dashboard sees more than 50 retained captures while external web remains bounded and cannot ACK them', async () => {
  const store = new MemoryCaptureStore();
  for (let index = 0; index < 61; index++) {
    const capture = createCapture({ platform: 'SWEA', problemNumber: String(index), title: 'test', problemUrl: 'https://example.test', language: 'Java', sourceCode: `class A${index} {}`, result: 'ACCEPTED' });
    assert.ok(capture); await store.putCapture(capture);
  }
  const bridge = new DashboardBridge(store);
  const own = await bridge.handleExtensionMessage({ type: 'CONNECT' }, sender, id); assert.ok('capability' in own);
  const result = await bridge.handleExtensionMessage({ type: 'GET_LOCAL_ARCHIVE', capability: own.capability, limit: 50 }, sender, id);
  assert.equal('captures' in result && result.captures.length, 61); assert.equal('hasMore' in result && result.hasMore, false);
  const web = { url: 'https://codearchive-dashboard-beta.netlify.app/', frameId: 0, documentId: 'web', tab: { id: 2, url: 'https://codearchive-dashboard-beta.netlify.app/' } };
  const remote = await bridge.handleMessage({ type: 'CONNECT' }, web); assert.ok('capability' in remote);
  const bounded = await bridge.handleMessage({ type: 'GET_LOCAL_ARCHIVE', capability: remote.capability, limit: 999 }, web);
  assert.equal('captures' in bounded && bounded.captures.length, 50);
  if ('captures' in result) assert.deepEqual(await bridge.handleExtensionMessage({ type: 'ACK', capability: own.capability, captureIds: [result.captures[0]!.captureId] }, sender, id), { error: 'BAD_REQUEST' });
  assert.equal(await store.countPending(), 61);
});
