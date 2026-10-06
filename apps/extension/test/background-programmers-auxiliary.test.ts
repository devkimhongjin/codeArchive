import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

type Listener = (message: unknown, sender: unknown, response: (value: unknown) => void) => boolean;
const extensionId = "test-extension";
const sourceTabId = 7;
const sourceUrl = "https://school.programmers.co.kr/learn/challenges?statuses=solved%2Csolved_with_unlock&page=1";
const lessonUrl = "https://school.programmers.co.kr/learn/courses/30/lessons/389481";
const routeKey = "codearchive-local-history-route";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test("Programmers auxiliary reads remain source-owned and always clean up their owned tab", async () => {
  let listener: Listener | undefined;
  let sourceCurrentUrl = sourceUrl;
  let nextTabId = 30;
  let createResult: (url: string) => { id?: number; url?: string; status?: string } | Promise<{ id?: number; url?: string; status?: string }> = url => ({ id: ++nextTabId, url, status: "complete" });
  let sendResult: (tabId: number, message: unknown) => Promise<unknown> = async () => ({ accountId: "947840" });
  const tabs = new Map<number, { id: number; url?: string; status?: string }>([[sourceTabId, { id: sourceTabId, url: sourceUrl, status: "complete" }]]);
  const removed: number[] = [];
  const creates: Array<{ url: string; active: boolean; windowId: number }> = [];
  const sent: Array<{ tabId: number; message: unknown; options: unknown }> = [];
  let injections = 0;
  let sourceQueries = 0;
  let removedListener: ((tabId: number) => void) | undefined;
  let updatedListener: ((tabId: number, change: { url?: string }) => void) | undefined;
  const session: Record<string, unknown> = {
    [routeKey]: { tabId: sourceTabId, url: sourceUrl, status: "SCANNING", platform: "PROGRAMMERS" }
  };
  const fakeChrome = {
    windows: {
      create: async () => {
        throw new Error("per-problem popup must never be opened");
      }
    },
    runtime: {
      id: extensionId, getManifest: () => ({ version: "0.2.2" }),
      onMessage: { addListener(callback: Listener) { listener = callback; } },
      onMessageExternal: { addListener() {} }
    },
    alarms: { get: async () => ({ name: "codearchive-extension-update" }), create() {}, onAlarm: { addListener() {} } },
    storage: { session: {
      get: async (key: string) => ({ [key]: session[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(session, value); },
      remove: async (key: string) => { delete session[key]; }
    } },
    tabs: {
      create: async ({ url, active, windowId }: { url: string; active: boolean; windowId: number }) => {
        creates.push({ url, active, windowId });
        const created = await createResult(url);
        if (Number.isSafeInteger(created.id)) tabs.set(created.id!, { ...created, id: created.id! });
        return created;
      },
      get: async (tabId: number) => {
        if (tabId === sourceTabId) return { id: sourceTabId, windowId: 9, url: sourceCurrentUrl, status: "complete" };
        const tab = tabs.get(tabId); if (!tab) throw new Error("tab missing");
        return tab;
      },
      remove: async (tabId: number) => { removed.push(tabId); tabs.delete(tabId); },
      sendMessage: async (tabId: number, message: unknown, options: unknown) => {
        sent.push({ tabId, message, options });
        return sendResult(tabId, message);
      },
      query: async () => { sourceQueries += 1; return []; },
      onRemoved: { addListener(callback: (tabId: number) => void) { removedListener = callback; } },
      onUpdated: { addListener(callback: (tabId: number, change: { url?: string }) => void) { updatedListener = callback; } }
    },
    scripting: { executeScript: async () => { injections += 1; } }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  const sender = { id: extensionId, getManifest: () => ({ version: "0.2.2" }), frameId: 0, tab: { id: sourceTabId }, url: sourceUrl };
  const historySender = { id: extensionId, getManifest: () => ({ version: "0.2.2" }), frameId: 0, url: `chrome-extension://${extensionId}/history.html` };
  const request = (message: unknown, from: unknown = sender) => new Promise<unknown>(resolve => {
    assert.equal(listener!(message, from, resolve), true);
  });
  try {
    await import("../src/background");
    assert.ok(listener);

    // A newly reopened history page defaults to Jungol while the persisted
    // Programmers task remains source-owned. Its read-only commands must not
    // turn that task into an interruption or disturb auxiliary authorization.
    const preservedScanningRoute = structuredClone(session[routeKey]) as { tabId: number; url: string; status: string; platform: string };
    assert.deepEqual(await request({ type: "LOCAL_HISTORY_STATUS" }, historySender), { status: "TAB_NOT_FOUND" });
    assert.deepEqual(session[routeKey], preservedScanningRoute);
    assert.deepEqual(await request({ type: "LOCAL_HISTORY_IMPORT_START", submissionIds: ["12345"] }, historySender), { status: "TAB_NOT_FOUND" });
    assert.deepEqual(await request({ type: "LOCAL_HISTORY_CANCEL" }, historySender), { status: "TAB_NOT_FOUND" });
    assert.deepEqual(session[routeKey], preservedScanningRoute);
    assert.equal(sourceQueries, 0); assert.equal(sent.length, 0); assert.equal(injections, 0);

    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: true, result: { accountId: "947840" } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.tabId, 31);
    assert.deepEqual(sent[0]!.options, { frameId: 0 });
    assert.deepEqual(removed, [31]);
    assert.deepEqual(creates[0], { url: lessonUrl, active: true, windowId: 9 });

    session[routeKey] = { ...preservedScanningRoute, status: "IMPORTING" };
    const preservedImportingRoute = structuredClone(session[routeKey]);
    assert.deepEqual(await request({ type: "LOCAL_HISTORY_STATUS" }, historySender), { status: "TAB_NOT_FOUND" });
    assert.deepEqual(session[routeKey], preservedImportingRoute);
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "import", submissionId: "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java" }), { ok: true, result: { accountId: "947840" } });
    assert.equal(removed.filter(tabId => tabId === 32).length, 1, "the active importing route still authorizes and cleans up its auxiliary tab");

    const sweaRoute = { tabId: 99, url: "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do", status: "SCANNING", platform: "SWEA" };
    session[routeKey] = sweaRoute;
    assert.deepEqual(await request({ type: "LOCAL_HISTORY_STATUS" }, historySender), { status: "TAB_NOT_FOUND" });
    assert.deepEqual(session[routeKey], sweaRoute);
    // Restore the status the remaining preview-only auxiliary cases expect.
    session[routeKey] = preservedScanningRoute;

    // A new inactive Chrome tab can remain loading longer than the original
    // 1.5-second window. Advance the background's polling clock without a
    // real twenty-second test wait and keep about:blank/loading transient.
    const delayedId = nextTabId + 1;
    const defaultGet = fakeChrome.tabs.get;
    let virtualElapsed = 0;
    fakeChrome.tabs.get = async tabId => tabId === delayedId && virtualElapsed < 1_800
      ? { id: tabId, url: "about:blank", status: "loading" }
      : defaultGet(tabId);
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((callback: () => void, delay?: number) => {
      if (delay === 45_000) return realSetTimeout(callback, delay);
      virtualElapsed += delay ?? 0;
      queueMicrotask(callback);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: true, result: { accountId: "947840" } });
    } finally {
      globalThis.setTimeout = realSetTimeout;
      fakeChrome.tabs.get = defaultGet;
    }
    assert.ok(virtualElapsed >= 1_800, "the bounded readiness wait permits a delayed committed navigation");

    // Chrome's sender.url can retain the document's original page while a
    // React pagination transition updates tabs.get().url before the first read.
    sourceCurrentUrl = sourceUrl.replace("page=1", "page=3");
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: true, result: { accountId: "947840" } });
    assert.equal(creates.at(-1)?.windowId, 9);
    sourceCurrentUrl = sourceUrl;

    const createsAfterValidRead = nextTabId;
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }, { ...sender, id: "other-extension" }), { ok: false, error: "UNAUTHORIZED" });
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }, { ...sender, tab: { id: 31 } }), { ok: false, error: "UNAUTHORIZED" });
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl: `${lessonUrl}?page=2`, mode: "preview" }), { ok: false, error: "BAD_REQUEST" });
    session[routeKey] = { tabId: sourceTabId, url: sourceUrl, status: "READY", platform: "PROGRAMMERS" };
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: false, error: "UNAUTHORIZED" });
    assert.equal(nextTabId, createsAfterValidRead, "rejected calls must not create a tab");
    session[routeKey] = { tabId: sourceTabId, url: sourceUrl, status: "SCANNING", platform: "PROGRAMMERS" };

    createResult = url => ({ id: ++nextTabId, url, status: "complete" });
    const redirectId = nextTabId + 1;
    const normalGet = fakeChrome.tabs.get;
    fakeChrome.tabs.get = async tabId => tabId === redirectId ? { id: tabId, url: "https://school.programmers.co.kr/users/profile", status: "complete" } : normalGet(tabId);
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: false, error: "REDIRECTED" });
    assert.ok(removed.includes(redirectId));
    fakeChrome.tabs.get = normalGet;

    sendResult = async tabId => {
      tabs.set(tabId, { id: tabId, url: "https://school.programmers.co.kr/users/profile", status: "complete" });
      return { accountId: "947840" };
    };
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: false, error: "REDIRECTED" }, "the auxiliary URL is checked again after a read");

    sendResult = async () => { sourceCurrentUrl = "https://school.programmers.co.kr/learn/challenges?statuses=solved%2Csolved_with_unlock&page=2"; return { accountId: "947840" }; };
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "import", submissionId: "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java" }), { ok: true, result: { accountId: "947840" } }, "pagination retains the verified listing source");
    sourceCurrentUrl = "https://school.programmers.co.kr/learn/challenges?statuses=solved%2Csolved_with_unlock&page=1";
    sendResult = async () => { sourceCurrentUrl = "https://school.programmers.co.kr/learn/challenges"; return { accountId: "947840" }; };
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: false, error: "INTERRUPTED" });
    sourceCurrentUrl = sourceUrl;
    sendResult = async () => ({ accountId: "947840" });

    const opening = deferred<{ id?: number; url?: string; status?: string }>();
    const openingId = nextTabId + 1;
    createResult = () => opening.promise;
    const openingRead = request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_CANCEL" }), { ok: true });
    opening.resolve({ id: openingId, url: "about:blank", status: "loading" });
    assert.deepEqual(await openingRead, { ok: false, error: "INTERRUPTED" });
    assert.ok(removed.includes(openingId), "cancellation while opening closes the newly returned owned tab");
    createResult = url => ({ id: ++nextTabId, url, status: "complete" });

    const duringRead = deferred<unknown>();
    sendResult = async () => duringRead.promise;
    const reading = request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_CANCEL" }), { ok: true });
    duringRead.resolve({ accountId: "947840" });
    assert.deepEqual(await reading, { ok: false, error: "INTERRUPTED" });

    // A hung receiver is released without requiring the user to close its
    // window, and its eventual response cannot revive or store that read.
    const hungRead = deferred<unknown>(); let expireRead: (() => void) | undefined;
    sendResult = async () => hungRead.promise;
    const nativeSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      if (delay === 45_000) { expireRead = callback; return nativeSetTimeout(() => undefined, 60_000); }
      return nativeSetTimeout(callback, delay);
    }) as typeof setTimeout;
    try {
      const timeoutId = nextTabId + 1;
      const pendingTimeout = request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "import", submissionId: "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java" });
      await new Promise(resolve => nativeSetTimeout(resolve, 0));
      assert.ok(expireRead); expireRead();
      assert.deepEqual(await pendingTimeout, { ok: false, error: "READ_TIMEOUT" });
      assert.equal(removed.filter(id => id === timeoutId).length, 1);
      assert.ok(tabs.has(sourceTabId), "the source is never closed by the deadline");
      sendResult = async () => ({ accountId: "947840" });
      assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: true, result: { accountId: "947840" } });
      hungRead.resolve({ status: "DONE", capture: { sourceCode: "must be ignored" } });
      await new Promise(resolve => nativeSetTimeout(resolve, 0));
      assert.equal(removed.filter(id => id === timeoutId).length, 1);
    } finally { globalThis.setTimeout = nativeSetTimeout; }

    sendResult = async () => { throw new Error("read failed"); };
    const beforeReadFailure = removed.length;
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: false, error: "READ_FAILED" });
    assert.equal(removed.length, beforeReadFailure + 1, "read errors close the owned tab");

    sendResult = async () => { throw new Error("Could not establish connection. Receiving end does not exist."); };
    assert.deepEqual(await request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" }), { ok: false, error: "READ_FAILED" });
    assert.equal(injections, 1, "only a missing receiver permits a one-time content injection");

    assert.ok(removedListener); assert.ok(updatedListener);
    const sourceRun = deferred<unknown>();
    sendResult = async () => sourceRun.promise;
    const pending = request({ type: "PROGRAMMERS_AUX_READ", lessonUrl, mode: "preview" });
    await new Promise(resolve => setTimeout(resolve, 0));
    updatedListener!(sourceTabId, { url: "https://school.programmers.co.kr/learn/challenges" });
    await new Promise(resolve => setTimeout(resolve, 0));
    sourceRun.resolve({ accountId: "947840" });
    assert.deepEqual(await pending, { ok: false, error: "INTERRUPTED" });
    sourceCurrentUrl = sourceUrl;
  } finally {
    Object.assign(globalThis, previous);
  }
});
