import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY_TIMING_STORAGE_KEY, estimateHistoricalDuration, estimateHistoricalTotalDuration, persistHistoricalTimingSample, readHistoricalTimingSample, timingSampleFromCompletedTask } from "../src/historyTiming";

test("current-run estimate learns from each settled item and the complete run uses actual duration", () => {
  const sample = timingSampleFromCompletedTask({ status: "DONE", total: 2, completed: 2, skipped: 0,
    saved: 2, duplicate: 0, startedAt: 1_000, endedAt: 9_000 })!;
  const task = { status: "IMPORTING", total: 4, completed: 0, startedAt: 1_000, lastProgressAt: 1_000 };
  assert.equal(estimateHistoricalTotalDuration(task, null), null);
  assert.equal(estimateHistoricalTotalDuration(task, sample), 16_000);
  assert.equal(estimateHistoricalTotalDuration({ ...task, completed: 1, lastProgressAt: 11_000 }, sample), 40_000);
  assert.equal(estimateHistoricalTotalDuration({ ...task, completed: 2, lastProgressAt: 15_000 }, sample), 28_000);
  assert.equal(estimateHistoricalTotalDuration({ ...task, status: "DONE", completed: 4, lastProgressAt: 30_000, endedAt: 31_000 }, sample), 30_000);
  assert.equal(estimateHistoricalTotalDuration({ ...task, completed: 5 }, sample), null);
  assert.equal(estimateHistoricalTotalDuration({ ...task, completed: -1 }, sample), null);
});

test("a completed local run creates timing evidence and a proportional forecast", () => {
  const sample = timingSampleFromCompletedTask({ status: "DONE", total: 10, completed: 10, skipped: 0,
    saved: 8, duplicate: 2, startedAt: 1_000, endedAt: 31_000 });
  assert.deepEqual(sample, { version: 1, platform: "JUNGOL", count: 10, durationMs: 30_000, startedAt: 1_000, endedAt: 31_000 });
  assert.equal(estimateHistoricalDuration(sample, 25), 75_000);
  assert.deepEqual(readHistoricalTimingSample(sample), sample);
});

test("partial, cancelled, and malformed timing evidence is ignored", () => {
  assert.equal(timingSampleFromCompletedTask({ status: "INTERRUPTED", total: 10, completed: 4, skipped: 0,
    saved: 4, duplicate: 0, startedAt: 1, endedAt: 2 }), null);
  assert.equal(timingSampleFromCompletedTask({ status: "DONE", total: 10, completed: 10, skipped: 1,
    saved: 9, duplicate: 0, startedAt: 1, endedAt: 2 }), null);
  assert.equal(readHistoricalTimingSample({ version: 1, platform: "JUNGOL", count: 10, durationMs: 0, startedAt: 1, endedAt: 1 }), null);
});


test("the source-owned persistence helper writes only the dedicated timing record", async () => {
  const calls: Record<string, unknown>[] = [];
  const sample = { version: 1 as const, platform: "JUNGOL" as const, count: 10 as const, durationMs: 1_000, startedAt: 4, endedAt: 1_004 };
  await persistHistoricalTimingSample({ set: async items => { calls.push(items); } }, sample);
  assert.deepEqual(calls, [{ [HISTORY_TIMING_STORAGE_KEY]: sample }]);
});


test("a fully completed ordinary import of any bounded size becomes timing evidence", () => {
  const sample = timingSampleFromCompletedTask({ status: "DONE", total: 3, completed: 3, skipped: 0,
    saved: 2, duplicate: 1, startedAt: 10, endedAt: 910 });
  assert.deepEqual(sample, { version: 1, platform: "JUNGOL", count: 3, durationMs: 900, startedAt: 10, endedAt: 910 });
});
