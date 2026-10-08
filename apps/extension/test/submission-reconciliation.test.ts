import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexedDB } from 'fake-indexeddb'
import { reconcileSubmissions, type ReconciliationRecord } from '../../../shared/submissionReconciliation'
import { createCapture } from '../src/capture'
import { IndexedDbCaptureStore, MemoryCaptureStore } from '../src/storage'

const candidate = { submissionId: 'Submission0001', problemNumber: '123', language: 'JAVA', solvedAt: '2026-09-28T08:26:00+09:00' }
const record: ReconciliationRecord = { captureId: '11111111-1111-4111-8111-111111111111', platform: 'SWEA', historicalSubmissionId: candidate.submissionId, problemNumber: '123', language: 'Java', solvedAt: '2026-09-27T23:26:00Z', sourceDigest: 'a'.repeat(64) }
const status = (local: ReconciliationRecord[], remote: ReconciliationRecord[], complete = true) => reconcileSubmissions('SWEA', [candidate], local, remote, complete)[0]!.state
test('distinguishes local, remote, matched, enrichment, ambiguous and unsupported without invented identities', () => {
  assert.equal(status([], []), 'missing_local')
  assert.equal(status([record], []), 'missing_remote')
  assert.equal(status([record], [record]), 'matched')
  assert.equal(status([{ ...record, metadataPending: true }], [record]), 'enrichment_available')
  assert.equal(status([record], [], false), 'unsupported')
  assert.equal(status([record, record], []), 'ambiguous')
  assert.equal(status([record], [{ ...record, sourceDigest: 'b'.repeat(64) }]), 'ambiguous')
  assert.equal(status([{ ...record, historicalSubmissionId: undefined }], []), 'ambiguous')
  assert.equal(status([{ ...record, problemNumber: '124' }], []), 'ambiguous')
})
test('Programmers composite submission keys retain account/time/language and ambiguous duplicates are excluded', () => {
  const c = { ...candidate, submissionId: 'pg:own:123:2026-09-28T08:26:00.000+09:00:java' }
  const r = { ...record, platform: 'PROGRAMMERS', historicalSubmissionId: c.submissionId }
  assert.equal(reconcileSubmissions('PROGRAMMERS', [c], [r], [r], true)[0]!.state, 'matched')
  assert.equal(reconcileSubmissions('PROGRAMMERS', [c, c], [r], [], true)[0]!.state, 'ambiguous')
  assert.equal(reconcileSubmissions('PROGRAMMERS', [{ ...c, submissionId: c.submissionId.replace(':own:', ':other:') }], [r], [], true)[0]!.state, 'missing_local')
  assert.equal(reconcileSubmissions('PROGRAMMERS', [{ ...c, language: undefined }], [r], [], true)[0]!.state, 'unsupported')
})
for (const mode of ['memory', 'indexeddb'] as const) test(`${mode}: enriches only verified same-submission blanks and preserves trusted source/core identity`, async () => {
  const store = mode === 'memory' ? new MemoryCaptureStore() : new IndexedDbCaptureStore({ indexedDb: indexedDB, databaseName: `reconciliation-${crypto.randomUUID()}` })
  const old = createCapture({ captureId: record.captureId, platform: 'SWEA', problemNumber: '123', title: 'Title', problemUrl: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=VerifiedKey', language: 'JAVA', sourceCode: 'class Main {}', result: 'ACCEPTED', solvedAt: record.solvedAt, observedAt: record.solvedAt, historicalImport: true, historicalSubmissionId: candidate.submissionId })!
  await store.putCapture(old); await store.markSynced([old.captureId])
  const incoming = { ...old, captureId: '22222222-2222-4222-8222-222222222222', executionTime: 10, memoryValue: 2048, memoryUnit: 'KB' as const, difficulty: { label: 'D3', problemNumber: '123', sourceUrl: old.problemUrl } }
  assert.equal((await store.putCapture(incoming)).reconciliation, 'enrichment_available')
  const saved = (await store.getCapture(old.captureId))!
  assert.equal(saved.sourceCode, old.sourceCode); assert.equal(saved.observedAt, old.observedAt); assert.equal(saved.solvedAt, old.solvedAt); assert.equal(saved.captureId, old.captureId)
  assert.equal(saved.difficulty?.label, 'D3'); assert.equal(saved.executionTime, 10); assert.equal(saved.metadataPending, true)
  assert.equal((await store.putCapture({ ...incoming, executionTime: 99 })).created, false)
  assert.equal((await store.getCapture(old.captureId))!.executionTime, 10)
  assert.equal((await store.putCapture({ ...incoming, sourceCode: 'class Wrong {}' })).reconciliation, 'ambiguous')
  assert.equal((await store.listAll()).length, 1)
  await store.markSynced([old.captureId]); assert.equal((await store.getCapture(old.captureId))!.metadataPending, false)
})

for (const mode of ['memory', 'indexeddb'] as const) test(`${mode}: stale upload ACK preserves newer metadata revision atomically`, async () => {
  const store = mode === 'memory' ? new MemoryCaptureStore() : new IndexedDbCaptureStore({ indexedDb: indexedDB, databaseName: `ack-revision-${crypto.randomUUID()}` });
  const base = createCapture({ captureId: record.captureId, platform: 'SWEA', problemNumber: '123', title: 'Title', problemUrl: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=VerifiedKey', language: 'JAVA', sourceCode: 'class Main {}', result: 'ACCEPTED', solvedAt: record.solvedAt, historicalImport: true, historicalSubmissionId: candidate.submissionId })!;
  await store.putCapture(base);
  await store.putCapture({ ...base, captureId: crypto.randomUUID(), executionTime: 10 });
  assert.equal((await store.getCapture(base.captureId))!.metadataRevision, 1);
  await store.putCapture({ ...base, captureId: crypto.randomUUID(), executionTime: 10, memoryValue: 2048, memoryUnit: 'KB' });
  assert.deepEqual(await store.markSynced([base.captureId], new Map([[base.captureId, 1]])), []);
  const pending = (await store.getCapture(base.captureId))!;
  assert.equal(pending.metadataRevision, 2); assert.equal(pending.metadataPending, true); assert.equal(pending.syncState, 'PENDING');
  assert.deepEqual(await store.markSynced([base.captureId], new Map([[base.captureId, 2]])), [base.captureId]);
  assert.equal((await store.getCapture(base.captureId))!.metadataPending, false);
});
