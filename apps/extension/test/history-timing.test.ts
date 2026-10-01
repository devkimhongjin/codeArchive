import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY_TIMING_STORAGE_KEY, estimateHistoricalDuration, persistHistoricalTimingSample, readHistoricalTimingSample, timingSampleFromCompletedTask } from "../src/historyTiming";
import { HISTORY_SCAN_TIMING_STORAGE_KEY, INITIAL_JUNGOL_SCAN_DURATION_MS, persistHistoricalScanTimingSample,
  readHistoricalScanTimingSample, scanTimingSampleFromCompletedTask } from "../src/historyTiming";

test("candidate scan evidence stays separate from import timing and rejects unfinished scans", async () => {
  assert.equal(INITIAL_JUNGOL_SCAN_DURATION_MS, 41_000);
  const task = { status: "READY", truncated: false, startedAt: 1_000, endedAt: 42_000 };
  const sample = scanTimingSampleFromCompletedTask(task)!;
  assert.equal(sample.durationMs, 41_000);
  assert.deepEqual(readHistoricalScanTimingSample(sample), sample);
  assert.equal(readHistoricalTimingSample(sample), null);
  for (const status of ["SCANNING", "SCAN_INCOMPLETE", "SCAN_FAILED", "INTERRUPTED"]) {
    assert.equal(scanTimingSampleFromCompletedTask({ ...task, status }), null);
  }
  assert.equal(scanTimingSampleFromCompletedTask({ ...task, truncated: true }), null);
  assert.equal(scanTimingSampleFromCompletedTask({ ...task, endedAt: 1_000 }), null);
  assert.equal(readHistoricalScanTimingSample({ ...sample, phase: "IMPORT" }), null);
  const writes: Record<string, unknown>[] = [];
  await persistHistoricalScanTimingSample({ set: async value => { writes.push(value); } }, sample);
  assert.deepEqual(writes, [{ [HISTORY_SCAN_TIMING_STORAGE_KEY]: sample }]);
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
