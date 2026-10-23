import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

test("SWEA and Programmers scans open their own list in an inactive tab and refuse a signed-out redirect", async () => {
  const id = "test-extension";
  const stored: Record<string, unknown> = {};
  const tabs = new Map<number, { id: number; url: string; status: string; active: boolean }>();
  const created: Array<{ url: string; active: boolean }> = [], removed: number[] = [];
  const updatedListeners: Array<(tabId: number, info: unknown, tab: unknown) => void> = [];
  let nextTabId = 40, redirect: string | null = null;
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const fakeChrome = {
    runtime: { id, getManifest: () => ({ version: "1.0.6" }), onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    storage: { session: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
      remove: async (key: string) => { delete stored[key]; }
    } },
    alarms: { clear: async () => true, get: async () => undefined, create() {}, onAlarm: { addListener() {} } },
    tabs: {
      onUpdated: { addListener(callback: (tabId: number, info: unknown, tab: unknown) => void) { updatedListeners.push(callback); }, removeListener() {} },
      onRemoved: { addListener() {} },
      query: async () => [...tabs.values()],
      create: async ({ url, active }: { url: string; active: boolean }) => {
        const tab = { id: nextTabId++, url: redirect ?? url, status: "complete", active };
        tabs.set(tab.id, tab); created.push({ url, active }); return tab;
      },
      update: async (tabId: number) => tabs.get(tabId),
      get: async (tabId: number) => { const tab = tabs.get(tabId); if (!tab) throw new Error("No tab"); return tab; },
      remove: async (tabId: number) => { tabs.delete(tabId); removed.push(tabId); },
      sendMessage: async () => ({ status: "READY", candidates: [] })
    },
    scripting: { executeScript: async () => [] }
  };
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  try {
    await import("../src/background");
    const historyPage = { id, frameId: 0, url: `chrome-extension://${id}/history.html`, tab: { id: 5 } };
    const scan = (platform: string) => new Promise<{ status?: string }>(resolve =>
      listener!({ type: "LOCAL_HISTORY_SCAN_START", platform }, historyPage, resolve as (value: unknown) => void));

    assert.equal((await scan("SWEA")).status, "READY");
    assert.deepEqual(created.at(-1), { url: "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do", active: false });
    assert.equal((stored["codearchive-owned-history-tab"] as { tabId: number }).tabId, 40);

    tabs.clear(); delete stored["codearchive-owned-history-tab"]; delete stored["codearchive-local-history-route"];
    assert.equal((await scan("PROGRAMMERS")).status, "READY");
    assert.deepEqual(created.at(-1), { url: "https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1", active: false });

    // Signed out: the site redirects to its login page, which is never adopted.
    tabs.clear(); delete stored["codearchive-owned-history-tab"]; delete stored["codearchive-local-history-route"];
    redirect = "https://swexpertacademy.com/main/identity/anonymous/loginPage.do";
    assert.deepEqual(await scan("SWEA"), { status: "TAB_NOT_FOUND" });
    assert.equal(tabs.size, 0);
    assert.ok(removed.length >= 1);
  } finally { Object.assign(globalThis, previous); }
});
