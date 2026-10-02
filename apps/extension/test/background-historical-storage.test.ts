import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { createCapture } from "../src/capture";
import { IndexedDbCaptureStore } from "../src/storage";

test("historical store accepts an owned SPA import and rejects unbound or moved source requests", async () => {
  const id = "test-extension", tabId = 7;
  const listingUrl = "https://jungol.co.kr/account/9/submission";
  let currentUrl = listingUrl;
  const routeKey = "codearchive-local-history-route";
  const session: Record<string, unknown> = { [routeKey]: { tabId, url: listingUrl, status: "IMPORTING" } };
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  let duringStart: (() => void) | undefined;
  const fakeChrome = {
    runtime: { id, onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    storage: { session: {
      get: async (key: string) => ({ [key]: session[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(session, value); },
      remove: async (key: string) => { delete session[key]; }
    } },
    tabs: {
      get: async (sourceId: number) => { assert.equal(sourceId, tabId); return { id: tabId, url: currentUrl }; },
      query: async () => [{ id: tabId, url: currentUrl }],
      sendMessage: async () => { duringStart?.(); return { status: "IMPORTING" }; }
    }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  try {
    await import("../src/background");
    assert.ok(listener);
    const capture = createCapture({
      platform: "JUNGOL", problemNumber: "1000", title: "Fixture", problemUrl: "https://jungol.co.kr/problem/1000",
      language: "Java", sourceCode: "hello", result: "ACCEPTED", solvedAt: "2026-09-29T01:00:00.000Z",
      observedAt: "2026-10-01T01:00:00.000Z", historicalImport: true, historicalSubmissionId: "12345"
    });
    assert.ok(capture);
    const sender = { id, frameId: 0, tab: { id: tabId, url: "https://jungol.co.kr/" }, url: "https://jungol.co.kr/" };
    const storeRequest = (from: unknown = sender) => new Promise<unknown>(resolve => listener!({ type: "STORE_HISTORICAL_CAPTURE", capture }, from, resolve));
    assert.deepEqual(await storeRequest(), { ok: true, created: true });
    assert.deepEqual(await storeRequest(), { ok: true, created: false });

    const rejected = { ok: false, error: "INVALID_HISTORICAL_CAPTURE" };
    for (const from of [{ ...sender, frameId: 1 }, { ...sender, id: "other-extension" }, { ...sender, url: "https://evil.example/" }]) {
      assert.deepEqual(await storeRequest(from), rejected);
    }
    session[routeKey] = { tabId, url: listingUrl, status: "READY" };
    assert.deepEqual(await storeRequest(), rejected);
    session[routeKey] = { tabId, url: listingUrl, status: "IMPORTING" };
    currentUrl = "https://jungol.co.kr/account/10/submission";
    assert.deepEqual(await storeRequest(), rejected);
    currentUrl = "https://jungol.co.kr/";
    assert.deepEqual(await storeRequest(), rejected);
    currentUrl = listingUrl;
    delete session[routeKey];
    assert.deepEqual(await storeRequest(), rejected);
    // A direct verified listing sender keeps the established legacy contract.
    assert.deepEqual(await storeRequest({ ...sender, url: listingUrl }), { ok: true, created: false });
    session[routeKey] = { tabId, url: listingUrl, status: "READY" };
    let firstStore!: Promise<unknown>;
    duringStart = () => { firstStore = storeRequest(); };
    const importing = await new Promise<unknown>(resolve => listener!({ type: "LOCAL_HISTORY_IMPORT_START", submissionIds: ["12345"] },
      { id, frameId: 0, url: `chrome-extension://${id}/history.html` }, resolve));
    assert.deepEqual(importing, { status: "IMPORTING" });
    assert.deepEqual(await firstStore, { ok: true, created: false }, "first store must wait for its import route write without deadlocking");
    const retained = await new IndexedDbCaptureStore().listHistorical();
    assert.equal(retained.totalCount, 1, "rejected requests must not add local records");
  } finally { Object.assign(globalThis, previous); }
});
