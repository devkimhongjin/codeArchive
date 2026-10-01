import assert from "node:assert/strict";
import test from "node:test";
import { mayRediscoverHistorySource, mayStoreLocalHistoryCapture, sameHistorySource } from "../src/historyRouting";

test("local history keeps an owned same-account source through a sid detail dialog", () => {
  assert.equal(sameHistorySource("https://jungol.co.kr/submission?account=mine", "https://jungol.co.kr/submission?account=mine&sid=9"), true);
  assert.equal(sameHistorySource("https://jungol.co.kr/submission?account=mine", "https://jungol.co.kr/submission?account=other&sid=9"), false);
  assert.equal(sameHistorySource("https://jungol.co.kr/account/9/submission", "https://jungol.co.kr/account/10/submission?sid=9"), false);
});

test("only an explicit scan can replace a stale local-history source route", () => {
  assert.equal(mayRediscoverHistorySource("LOCAL_HISTORY_SCAN_START"), true);
  assert.equal(mayRediscoverHistorySource("LOCAL_HISTORY_STATUS"), false);
  assert.equal(mayRediscoverHistorySource("LOCAL_HISTORY_IMPORT_START"), false);
  assert.equal(mayRediscoverHistorySource("LOCAL_HISTORY_CANCEL"), false);
});

test("a cancelled or replaced job cannot store a capture after its detail dialog resolves", () => {
  const listing = "https://jungol.co.kr/submission?account=mine";
  const detail = "https://jungol.co.kr/submission?account=mine&sid=9";
  assert.equal(mayStoreLocalHistoryCapture(true, false, listing, detail), true);
  assert.equal(mayStoreLocalHistoryCapture(true, true, listing, detail), false);
  assert.equal(mayStoreLocalHistoryCapture(false, false, listing, detail), false);
  assert.equal(mayStoreLocalHistoryCapture(true, false, listing, "https://jungol.co.kr/submission?account=other&sid=9"), false);
});
