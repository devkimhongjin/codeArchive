import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

test("a Jungol scan opens the signed-in list in an inactive tab and closes it when the run ends", async () => {
  const id = "test-extension";
  const stored: Record<string, unknown> = {};
  const tabs = new Map<number, { id: number; url: string; status: string; active: boolean }>();
  const created: Array<{ url: string; active: boolean }> = [], removed: number[] = [];
  const updatedListeners: Array<(tabId: number, info: unknown, tab: unknown) => void> = [];
  const removedListeners: Array<(tabId: number) => void> = [];
  let nextTabId = 20, homeAccounts = ["152511"], scanStatus = "READY", importStatus = "IMPORTING";
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const fakeChrome = {
    runtime: { id, getManifest: () => ({ version: "1.0.4" }), onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    storage: { session: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
      remove: async (key: string) => { delete stored[key]; }
    } },
    alarms: { clear: async () => true, get: async () => ({ name: "codearchive-extension-update" }), create() {}, onAlarm: { addListener() {} } },
    tabs: {
      onUpdated: { addListener(callback: (tabId: number, info: unknown, tab: unknown) => void) { updatedListeners.push(callback); }, removeListener() {} },
      onRemoved: { addListener(callback: (tabId: number) => void) { removedListeners.push(callback); } },
      query: async () => [...tabs.values()].filter(tab => /\/account\/\d+\/submission$/.test(new URL(tab.url).pathname)),
      create: async ({ url, active }: { url: string; active: boolean }) => {
        const tab = { id: nextTabId++, url, status: "complete", active };
        tabs.set(tab.id, tab); created.push({ url, active }); return tab;
      },
      update: async (tabId: number, change: { url?: string }) => {
        const tab = tabs.get(tabId)!;
        if (change.url) { tab.url = change.url; tab.status = "complete"; updatedListeners.forEach(callback => callback(tabId, { status: "complete" }, tab)); }
        return tab;
      },
      get: async (tabId: number) => { const tab = tabs.get(tabId); if (!tab) throw new Error("No tab"); return tab; },
      remove: async (tabId: number) => { tabs.delete(tabId); removed.push(tabId); removedListeners.forEach(callback => callback(tabId)); },
      sendMessage: async (_tabId: number, message: { type: string }) => message.type === "LOCAL_HISTORY_SCAN_START" ? { status: scanStatus, candidates: [] }
        : message.type === "LOCAL_HISTORY_STATUS" ? { status: importStatus } : { status: "IDLE" }
    },
    scripting: { executeScript: async (details: { func?: unknown }) => details.func ? [{ result: homeAccounts }] : [] }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  try {
    await import("../src/background");
    const historyPage = { id, frameId: 0, url: `chrome-extension://${id}/history.html`, tab: { id: 5 } };
    const command = (type: string) => new Promise<{ status?: string }>(resolve => listener!({ type }, historyPage, resolve as (value: unknown) => void));

    // No list is open: the extension opens one itself without focusing it.
    assert.equal((await command("LOCAL_HISTORY_SCAN_START")).status, "READY");
    assert.deepEqual(created, [{ url: "https://jungol.co.kr/", active: false }]);
    const ownedTabId = (stored["codearchive-owned-history-tab"] as { tabId: number }).tabId;
    assert.equal(tabs.get(ownedTabId)?.url, "https://jungol.co.kr/account/152511/submission");
    assert.deepEqual(removed, [], "a READY scan keeps the list for the import");

    // The import runs in that tab and the tab closes once it has ended.
    assert.equal((await command("LOCAL_HISTORY_STATUS")).status, "IMPORTING");
    assert.deepEqual(removed, []);
    importStatus = "DONE";
    assert.equal((await command("LOCAL_HISTORY_STATUS")).status, "DONE");
    assert.deepEqual(removed, [ownedTabId]);
    assert.equal(stored["codearchive-owned-history-tab"], undefined);

    // A scan that finds nothing usable does not leave the hidden tab behind.
    scanStatus = "OWNERSHIP_UNVERIFIED";
    assert.equal((await command("LOCAL_HISTORY_SCAN_START")).status, "OWNERSHIP_UNVERIFIED");
    assert.equal(tabs.size, 0);

    // Closing the history page also closes a list it was keeping open.
    scanStatus = "READY";
    assert.equal((await command("LOCAL_HISTORY_SCAN_START")).status, "READY");
    assert.equal(tabs.size, 1);
    removedListeners.forEach(callback => callback(5));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(tabs.size, 0);

    // An ambiguous home page is refused and its probe tab is removed.
    homeAccounts = ["1", "2"];
    assert.deepEqual(await command("LOCAL_HISTORY_SCAN_START"), { status: "TAB_NOT_FOUND" });
    assert.equal(tabs.size, 0);
  } finally { Object.assign(globalThis, previous); }
});
