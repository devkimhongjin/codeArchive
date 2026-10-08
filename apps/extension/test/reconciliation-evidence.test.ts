import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadReconciliationEvidence, validReconciliationRecord } from '../src/reconciliationEvidence'
import { MemoryCaptureStore } from '../src/storage'
import { createCapture } from '../src/capture'
const id = '11111111-1111-4111-8111-111111111111'
const record = { captureId: id, recordId: 10, platform: 'SWEA', historicalSubmissionId: 'OwnSubmission', problemNumber: '123', language: 'JAVA', solvedAt: '2026-01-02T03:04:05Z', sourceDigest: 'a'.repeat(64) }
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
async function store(accountId?: string) {
  const store = new MemoryCaptureStore(); if (accountId) await store.updateSettings({ accountId });
  await store.putCapture(createCapture({ captureId: id, platform: 'SWEA', problemNumber: '123', title: 'Test', language: 'JAVA', sourceCode: 'private source', result: 'ACCEPTED', solvedAt: record.solvedAt, problemUrl: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=OwnProblem', historicalImport: true, historicalSubmissionId: 'OwnSubmission' })!);
  return store;
}
test('logged-out reconciliation remains local and returns only source digest metadata', async () => {
  const evidence = await loadReconciliationEvidence(await store(), 'SWEA', (() => { throw new Error('must not fetch') }) as typeof fetch);
  assert.equal(evidence.localComplete, true); assert.equal(evidence.remoteComplete, false); assert.equal(evidence.serverReason, 'LOGIN_REQUIRED');
  assert.equal(evidence.local[0]!.sourceDigest?.length, 64); assert.equal(JSON.stringify(evidence).includes('private source'), false);
});
test('authenticated keyset reconciliation pins account and fixed API origin', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(url); assert.equal(init.credentials, 'include'); assert.equal(init.redirect, 'error');
    if (url.endsWith('/api/auth/me')) return json({ id: 1, githubId: '99' });
    assert.equal((init.headers as Record<string,string>)['X-CodeArchive-Account'], '99');
    return json({ records: [record], cursor: 10, hasMore: false });
  }) as typeof fetch;
  const evidence = await loadReconciliationEvidence(await store('1'), 'SWEA', fetcher);
  assert.equal(evidence.remoteComplete, true); assert.equal(evidence.remote.length, 1); assert.equal(calls.length, 3);
  assert.ok(calls.every(url => new URL(url).origin === 'https://codearchive-dashboard-beta.netlify.app'));
});
test('account switches, unsupported servers, duplicate IDs and stalled cursors discard partial remote results', async () => {
  for (const mode of ['switch', 'unsupported', 'duplicate', 'cursor'] as const) {
    const local = await store('1'); let requests = 0;
    const fetcher = (async (url: string) => {
      if (url.endsWith('/api/auth/me')) { if (mode === 'switch' && ++requests > 1) return json({ id: 2, githubId: '100' }); return json({ id: 1, githubId: '99' }); }
      if (mode === 'unsupported') return new Response('', { status: 404 });
      if (mode === 'duplicate') return json({ records: [record, record], cursor: 10, hasMore: false });
      if (mode === 'cursor') return json({ records: [record], cursor: 0, hasMore: true });
      return json({ records: [record], cursor: 10, hasMore: false });
    }) as typeof fetch;
    const evidence = await loadReconciliationEvidence(local, 'SWEA', fetcher);
    assert.equal(evidence.remoteComplete, false, mode); assert.deepEqual(evidence.remote, [], mode); assert.equal(evidence.localComplete, true);
  }
});
test('remote record validation rejects malformed UUID, digest and platform', () => {
  assert.equal(validReconciliationRecord(record, 'SWEA'), true);
  for (const changed of [{ captureId: '-'.repeat(36) }, { sourceDigest: 'invalid' }, { platform: 'JUNGOL' }]) assert.equal(validReconciliationRecord({ ...record, ...changed }, 'SWEA'), false);
});
