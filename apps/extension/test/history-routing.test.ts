import assert from "node:assert/strict";
import test from "node:test";
import { isLocalHistoryPageSender, mayRediscoverHistorySource, mayStoreHistoricalFromSender, mayStoreLocalHistoryCapture, sameHistorySource } from "../src/historyRouting";

test('collection frames are restricted to the same packaged history and dashboard documents', () => {
  const extensionId = 'fixture-extension';
  const page = { id: extensionId, frameId: 0, url: `chrome-extension://${extensionId}/history.html` };
  const embedded = { ...page, frameId: 7, url: `${page.url}?embedded=1`, tab: { id: 2, url: `chrome-extension://${extensionId}/dashboard.html?view=history` } };
  assert.equal(isLocalHistoryPageSender(page, extensionId), true);
  assert.equal(isLocalHistoryPageSender(embedded, extensionId), true);
  for (const sender of [
    { ...embedded, id: 'other-extension' }, { ...embedded, url: 'https://example.test/history.html' },
    { ...embedded, url: `chrome-extension://${extensionId}/popup.html` },
    { ...embedded, tab: { id: 2, url: 'https://example.test/dashboard.html' } },
    { ...embedded, tab: { id: 2, url: 'chrome-extension://other-extension/dashboard.html' } },
    { ...embedded, tab: { id: 2, url: `chrome-extension://${extensionId}/popup.html` } },
    { ...embedded, tab: undefined }, { ...embedded, frameId: undefined }, { ...embedded, frameId: -1 },
  ]) assert.equal(isLocalHistoryPageSender(sender, extensionId), false);
});

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

test("SPA storage requires a currently owned active import when the sender retains the homepage URL", () => {
  const url = "https://jungol.co.kr/account/9/submission";
  const route = { tabId: 7, url, status: "IMPORTING" };
  assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/", url, 7, route), true);
  assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/account/9", url, 7, route), true);
  assert.equal(mayStoreHistoricalFromSender(url, url, 7, null), true);
  assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/", url, 7, null), false);
  assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/", url, 8, route), false);
  for (const status of ["READY", "SCANNING", "DONE", "FAILED", "INTERRUPTED"]) {
    assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/", url, 7, { ...route, status }), false);
  }
  assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/", url, 7, { ...route, status: "CANCELLING" }), true);
  for (const changedUrl of ["https://jungol.co.kr/account/10/submission", "https://jungol.co.kr/account/9", "https://evil.example/account/9/submission"]) {
    assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/", changedUrl, 7, route), false);
  }
  assert.equal(mayStoreHistoricalFromSender("https://evil.example/", url, 7, route), false);
  assert.equal(mayStoreHistoricalFromSender("https://jungol.co.kr/account/10/submission", url, 7, route), false);
});
