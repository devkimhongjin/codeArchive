import assert from 'node:assert/strict';
import test from 'node:test';
import { HistoricalTaskController } from '../src/historicalTaskController';
import { belongsToCollection, isHistoricalCollectionNotice, isHistoricalCollectionScope } from '../../../shared/historicalCollectionScope';

test('completion receipts contain only selected submissions whose verified storage succeeded', async () => {
  const task = new HistoricalTaskController<string>(() => 123);
  task.start(['saved', 'duplicate', 'failed'], async id => id === 'saved'
    ? { saved: 1, duplicate: 0, skipped: 0 }
    : id === 'duplicate' ? { saved: 0, duplicate: 1, skipped: 0 }
      : { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: id }, undefined, id => id);
  await task.settled();
  assert.equal(task.state?.status, 'DONE');
  assert.deepEqual(task.state?.storedSubmissionIds, ['saved', 'duplicate']);
  assert.deepEqual(task.state?.failedSubmissionIds, ['failed']);
});
test('scope rejects malformed IDs and platform collisions', () => {
  const scope = { batchId: 'SWEA:123', platform: 'SWEA' as const, submissionIds: ['same-site-id'] };
  assert.equal(isHistoricalCollectionScope(scope), true);
  assert.equal(belongsToCollection({ platform: 'SWEA', historicalSubmissionId: 'same-site-id' }, scope), true);
  assert.equal(belongsToCollection({ platform: 'PROGRAMMERS', historicalSubmissionId: 'same-site-id' }, scope), false);
  for (const bad of [{ ...scope, platform: 'JUNGOL' }, { ...scope, submissionIds: ['x', 'x'] }, { ...scope, submissionIds: [] },
    { ...scope, submissionIds: ['\nprivate'] }, { ...scope, submissionIds: Array(5001).fill('x') }]) assert.equal(isHistoricalCollectionScope(bad), false);
  assert.equal(isHistoricalCollectionNotice({ type: 'CODEARCHIVE_HISTORY_COLLECTION', scope: null }), true);
  assert.equal(isHistoricalCollectionNotice({ type: 'OTHER', scope }), false);
});
