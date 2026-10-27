import assert from "node:assert/strict";
import test from "node:test";
import { OWNED_TAB_STALL_MS, localHistoryProgressSignature, trackStall } from "../src/ownedTabStall";

const scanning = (rows: number, pagesLoaded = 0, lastProgressAt = 1) =>
  ({ status: "SCANNING", progress: { phase: "pages", rows, pagesLoaded, groupsExpanded: 0, lastProgressAt } });

test("only a running task has a progress signature", () => {
  assert.equal(localHistoryProgressSignature({ status: "READY", candidates: [] }), null);
  assert.equal(localHistoryProgressSignature({ status: "DONE", completed: 3 }), null);
  assert.equal(localHistoryProgressSignature(null), null);
  assert.equal(localHistoryProgressSignature("SCANNING"), null);
  assert.notEqual(localHistoryProgressSignature(scanning(22)), null);
  assert.notEqual(localHistoryProgressSignature({ status: "IMPORTING", completed: 0, total: 4 }), null);
});

test("the signature moves with rows, pages, imports and the progress clock, not with waiting", () => {
  const base = localHistoryProgressSignature(scanning(22));
  assert.equal(localHistoryProgressSignature({ ...scanning(22), progress: { ...scanning(22).progress, stage: "waiting-pages" } }), base);
  assert.notEqual(localHistoryProgressSignature(scanning(52)), base);
  assert.notEqual(localHistoryProgressSignature(scanning(22, 1)), base);
  assert.notEqual(localHistoryProgressSignature(scanning(22, 0, 99)), base);
  const importing = localHistoryProgressSignature({ status: "IMPORTING", completed: 1, saved: 1, duplicate: 0, skipped: 0 });
  assert.notEqual(localHistoryProgressSignature({ status: "IMPORTING", completed: 2, saved: 2, duplicate: 0, skipped: 0 }), importing);
});

test("a task that stands still on one tab is stalled only after the window has passed", () => {
  const signature = localHistoryProgressSignature(scanning(22));
  const first = trackStall(null, 7, signature, 1_000);
  assert.deepEqual(first, { tracker: { tabId: 7, signature, since: 1_000 }, stalled: false });
  assert.equal(trackStall(first.tracker, 7, signature, 1_000 + OWNED_TAB_STALL_MS - 1).stalled, false);
  assert.equal(trackStall(first.tracker, 7, signature, 1_000 + OWNED_TAB_STALL_MS).stalled, true);
});

test("progress, another tab, or the end of the task restarts the clock", () => {
  const signature = localHistoryProgressSignature(scanning(22));
  const tracker = trackStall(null, 7, signature, 0).tracker;
  const moved = trackStall(tracker, 7, localHistoryProgressSignature(scanning(52)), OWNED_TAB_STALL_MS * 2);
  assert.equal(moved.stalled, false);
  assert.equal(moved.tracker?.since, OWNED_TAB_STALL_MS * 2);
  const otherTab = trackStall(tracker, 8, signature, OWNED_TAB_STALL_MS * 2);
  assert.equal(otherTab.stalled, false);
  assert.equal(otherTab.tracker?.tabId, 8);
  assert.deepEqual(trackStall(tracker, 7, null, OWNED_TAB_STALL_MS * 2), { tracker: null, stalled: false });
});
