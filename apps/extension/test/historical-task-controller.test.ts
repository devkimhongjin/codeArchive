import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalTaskController } from "../src/historicalTaskController";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("cancel holds the job lock through an in-flight store and keeps its accepted count", async () => {
  const task = new HistoricalTaskController<number>();
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
  store.resolve({ saved: 1, duplicate: 0, skipped: 0 });
  await task.settled();
  assert.deepEqual(task.state, { status: "INTERRUPTED", completed: 1, total: 2, saved: 1, duplicate: 0, skipped: 0 });
  assert.equal(secondStarted, false);
  assert.equal(task.start([3], async () => ({ saved: 1, duplicate: 0, skipped: 0 })), true);
  await task.settled();
});

test("one content-owned job processes all 501 selected submissions sequentially", async () => {
  const task = new HistoricalTaskController<number>();
  let previous = 0;
  assert.equal(task.start(Array.from({ length: 501 }, (_, index) => index + 1), async id => {
    assert.equal(id, previous + 1); previous = id;
    return { saved: 1, duplicate: 0, skipped: 0 };
  }), true);
  await task.settled();
  assert.deepEqual(task.state, { status: "DONE", completed: 501, total: 501, saved: 501, duplicate: 0, skipped: 0 });
});
