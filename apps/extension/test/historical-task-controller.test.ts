import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalTaskController } from "../src/historicalTaskController";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("cancel holds the job lock through an in-flight store and keeps its accepted count", async () => {
  let clock = 1_000;
  const task = new HistoricalTaskController<number>(() => clock);
  const store = deferred<{ saved: number; duplicate: number; skipped: number }>();
  let secondStarted = false;
  assert.equal(task.start([1, 2], async (id, mayStore) => {
    if (id === 2) secondStarted = true;
    assert.equal(mayStore(), true);
    return id === 1 ? store.promise : { saved: 1, duplicate: 0, skipped: 0 };
  }), true);
  task.cancel();
  assert.equal(task.state?.status, "CANCELLING");
  assert.equal(task.start([3], async () => ({ saved: 1, duplicate: 0, skipped: 0 })), false);
  assert.equal(task.mayStore(), false);
  clock = 9_000;
  store.resolve({ saved: 1, duplicate: 0, skipped: 0 });
  await task.settled();
  assert.deepEqual(task.state, { status: "INTERRUPTED", completed: 1, total: 2, saved: 1, duplicate: 0, skipped: 0,
    startedAt: 1_000, lastProgressAt: 9_000, endedAt: 9_000 });
  assert.equal(secondStarted, false);
  assert.equal(task.start([3], async () => ({ saved: 1, duplicate: 0, skipped: 0 })), true);
  await task.settled();
});

test("one content-owned job processes all 501 selected submissions sequentially", async () => {
  let clock = 1_000;
  const task = new HistoricalTaskController<number>(() => clock++);
  let previous = 0;
  assert.equal(task.start(Array.from({ length: 501 }, (_, index) => index + 1), async id => {
    assert.equal(id, previous + 1); previous = id;
    return { saved: 1, duplicate: 0, skipped: 0 };
  }), true);
  await task.settled();
  assert.equal(task.state?.status, "DONE");
  assert.equal(task.state?.completed, 501);
  assert.equal(task.state?.total, 501);
  assert.equal(task.state?.saved, 501);
  assert.ok((task.state?.endedAt ?? 0) > (task.state?.startedAt ?? 0));
});


test("settled-item callback identifies only completed candidate results", async () => {
  const task = new HistoricalTaskController<{ problemNumber: string }>(() => 1_000);
  const problems = new Set<string>();
  task.start([{ problemNumber: "1000" }, { problemNumber: "1000" }, { problemNumber: "2000" }],
    async () => ({ saved: 1, duplicate: 0, skipped: 0 }),
    (candidate, result) => { if (result.saved + result.duplicate > 0) problems.add(candidate.problemNumber); });
  await task.settled();
  assert.deepEqual([...problems], ["1000", "2000"]);
});


test("failed work reports only previously settled candidates to the result collector", async () => {
  const task = new HistoricalTaskController<{ key: string }>(() => 1_000);
  const settled: string[] = [];
  task.start([{ key: "JUNGOL:1000" }, { key: "JUNGOL:2000" }], async item => {
    if (item.key === "JUNGOL:2000") throw new Error("detail unavailable");
    return { saved: 1, duplicate: 0, skipped: 0 };
  }, item => { settled.push(item.key); });
  await task.settled();
  assert.equal(task.state?.status, "FAILED");
  assert.equal(task.state?.completed, 1);
  assert.deepEqual(settled, ["JUNGOL:1000"]);
});
