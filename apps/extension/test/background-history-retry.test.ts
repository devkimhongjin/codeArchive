import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

test("production history handler retries after entering submissions and reconnects a reloaded extension", async () => {
  const id = "test-extension";
  const source = { id: 7, url: "https://jungol.co.kr/" };
  const stored: Record<string, unknown> = {};
  let receiver = false, injections = 0, sends = 0;
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const fakeChrome = {
    runtime: { id, getManifest: () => ({ version: "0.2.2" }), onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    storage: { session: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
      remove: async (key: string) => { delete stored[key]; }
    } },
    alarms: { get: async () => ({ name: "codearchive-extension-update" }), create() {}, onAlarm: { addListener() {} } },
    tabs: {
      query: async () => [source],
      get: async (tabId: number) => { assert.equal(tabId, source.id); return source; },
      sendMessage: async (tabId: number, message: { type: string }, options: { frameId: number }) => {
        assert.equal(tabId, source.id); assert.equal(options.frameId, 0); sends++;
        if (!receiver) throw new Error("Could not establish connection. Receiving end does not exist.");
        return { status: "SCANNING", progress: { phase: "pages", rows: 1, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0 }, command: message.type };
      }
    },
    scripting: { executeScript: async (details: unknown) => {
      assert.deepEqual(details, { target: { tabId: source.id, frameIds: [0] }, files: ["content.js"], world: "ISOLATED" });
      injections++; receiver = true;
    } }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  try {
    await import("../src/background");
    assert.ok(listener);
    const sender = { id, frameId: 0, url: `chrome-extension://${id}/history.html` };
    const command = (type = "LOCAL_HISTORY_SCAN_START", requestSender: unknown = sender) => new Promise<unknown>(resolve => listener!({ type }, requestSender, resolve));

    // Clicking on the homepage binds no route and requires no script injection.
    assert.deepEqual(await command(), { status: "TAB_NOT_FOUND" });
    assert.equal(stored["codearchive-local-history-route"], undefined);
    assert.equal(sends, 0); assert.equal(injections, 0);

    // SPA navigation alone may leave an already-open tab without a receiver
    // after extension reload. The same first retry heals it without page reload.
    source.url = "https://jungol.co.kr/account/9/submission";
    const retried = await command() as { status: string };
    assert.equal(retried.status, "SCANNING");
    assert.equal(sends, 2); assert.equal(injections, 1);
    await command("LOCAL_HISTORY_STATUS");
    assert.equal(injections, 1);

    receiver = false;
    const [first, second] = await Promise.all([command(), command()]) as { status: string }[];
    assert.equal(first!.status, "SCANNING"); assert.equal(second!.status, "SCANNING");
    assert.equal(injections, 2, "concurrent requests must share the reconnected receiver");

    // A moved source cannot block the next explicitly chosen listing.
    source.url = "https://jungol.co.kr/account/9";
    assert.deepEqual(await command("LOCAL_HISTORY_STATUS"), { status: "TAB_NOT_FOUND" });
    source.url = "https://jungol.co.kr/account/10/submission";
    assert.equal((await command() as { status: string }).status, "SCANNING");
    assert.equal((stored["codearchive-local-history-route"] as unknown as { url: string }).url, source.url);

    const before = sends;
    assert.deepEqual(await command("LOCAL_HISTORY_SCAN_START", { ...sender, url: "https://jungol.co.kr/" }), { status: "UNAUTHORIZED" });
    assert.equal(sends, before);
  } finally { Object.assign(globalThis, previous); }
});
