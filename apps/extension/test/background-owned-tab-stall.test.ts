import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { OWNED_TAB_STALL_MS } from "../src/ownedTabStall";

const id = "test-extension";
const HISTORY_TAB = 5;
const HISTORY_WINDOW = 1;
const RUN_ID = "5b0e8a54-8d1b-4a53-9a25-4d6f0d8a1f10";
type FakeTab = { id: number; url: string; status: string; active: boolean; windowId: number };
type FakeWindow = { id: number; focused: boolean; left: number; top: number; width: number; height: number; state: string };
type Reply = Record<string, unknown>;

const scanning = (rows: number): Reply => ({ status: "SCANNING", progress: { phase: "pages", stage: "waiting-pages", rows, pagesLoaded: 0, groupsExpanded: 0, lastProgressAt: 1 } });
const importing = (completed: number): Reply => ({ status: "IMPORTING", completed, total: 3, saved: completed, duplicate: 0, skipped: 0 });

async function harness() {
  const stored: Record<string, unknown> = {};
  const tabs = new Map<number, FakeTab>([[HISTORY_TAB, { id: HISTORY_TAB, url: `chrome-extension://${id}/dashboard.html`, status: "complete", active: true, windowId: HISTORY_WINDOW }]]);
  const windows = new Map<number, FakeWindow>([[HISTORY_WINDOW, { id: HISTORY_WINDOW, focused: true, left: 0, top: 0, width: 1920, height: 1040, state: "maximized" }]]);
  const activated: number[] = [], removed: number[] = [], created: Array<{ url: string; active: boolean }> = [];
  const windowCreates: Array<Record<string, unknown>> = [], focusedWindows: number[] = [];
  const removedListeners: Array<(tabId: number) => void> = [];
  const updatedListeners: Array<(tabId: number, info: unknown, tab: unknown) => void> = [];
  const state = { nextTabId: 20, nextWindowId: 2, clock: 1_000_000, reply: scanning(22) as Reply, windowsEnabled: true };
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const deactivateSiblings = (windowId: number) => { for (const other of tabs.values()) if (other.windowId === windowId) other.active = false; };
  const focusWindow = (windowId: number) => { for (const other of windows.values()) other.focused = false; windows.get(windowId)!.focused = true; };
  const fakeChrome = {
    runtime: { id, getManifest: () => ({ version: "1.0.5" }), onMessage: { addListener(callback: typeof listener) { listener = callback; } }, onMessageExternal: { addListener() {} } },
    storage: { session: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
      remove: async (key: string) => { delete stored[key]; }
    } },
    alarms: { clear: async () => true, get: async () => ({ name: "codearchive-extension-update" }), create() {}, onAlarm: { addListener() {} } },
    windows: {
      create: async (options: { url: string; focused?: boolean; left?: number; top?: number; width?: number; height?: number }) => {
        if (!state.windowsEnabled) throw new Error("windows unavailable");
        windowCreates.push(options);
        const win: FakeWindow = { id: state.nextWindowId++, focused: false, left: options.left ?? 0, top: options.top ?? 0, width: options.width ?? 800, height: options.height ?? 600, state: "normal" };
        windows.set(win.id, win);
        const tab: FakeTab = { id: state.nextTabId++, url: options.url, status: "complete", active: true, windowId: win.id };
        tabs.set(tab.id, tab);
        if (options.focused) focusWindow(win.id);
        return { ...win, tabs: [tab] };
      },
      get: async (windowId: number) => { const win = windows.get(windowId); if (!win) throw new Error("No window"); return win; },
      update: async (windowId: number, change: { focused?: boolean }) => { if (change.focused) { focusWindow(windowId); focusedWindows.push(windowId); } return windows.get(windowId); }
    },
    tabs: {
      onUpdated: { addListener(callback: (tabId: number, info: unknown, tab: unknown) => void) { updatedListeners.push(callback); }, removeListener() {} },
      onRemoved: { addListener(callback: (tabId: number) => void) { removedListeners.push(callback); } },
      query: async ({ url }: { url: string }) => [...tabs.values()].filter(tab => tab.url.startsWith(url.replace(/\*$/, "")) && /(\/account\/\d+\/submission|userSubmitProblem\.do)/.test(tab.url)),
      create: async ({ url, active }: { url: string; active: boolean }) => {
        const tab: FakeTab = { id: state.nextTabId++, url, status: "complete", active, windowId: HISTORY_WINDOW };
        if (active) deactivateSiblings(HISTORY_WINDOW);
        tabs.set(tab.id, tab); created.push({ url, active }); return tab;
      },
      update: async (tabId: number, change: { url?: string; active?: boolean }) => {
        const tab = tabs.get(tabId)!;
        if (change.active) { deactivateSiblings(tab.windowId); tab.active = true; activated.push(tabId); }
        if (change.url) { tab.url = change.url; tab.status = "complete"; updatedListeners.forEach(callback => callback(tabId, { status: "complete" }, tab)); }
        return tab;
      },
      get: async (tabId: number) => { const tab = tabs.get(tabId); if (!tab) throw new Error("No tab"); return tab; },
      remove: async (tabId: number) => {
        const tab = tabs.get(tabId); tabs.delete(tabId); removed.push(tabId);
        if (tab && tab.windowId !== HISTORY_WINDOW && ![...tabs.values()].some(other => other.windowId === tab.windowId)) windows.delete(tab.windowId);
        removedListeners.forEach(callback => callback(tabId));
      },
      sendMessage: async (_tabId: number, message: { type: string }) =>
        ["LOCAL_HISTORY_SCAN_START", "LOCAL_HISTORY_STATUS", "LOCAL_HISTORY_IMPORT_START"].includes(message.type) ? state.reply : { status: "IDLE" }
    },
    scripting: { executeScript: async (details: { func?: unknown }) => details.func ? [{ result: ["152511"] }] : [] }
  };
  Object.assign(globalThis, { chrome: fakeChrome, indexedDB, IDBKeyRange });
  await import("../src/background");
  const historyPage = { id, frameId: 0, url: `chrome-extension://${id}/history.html`, tab: { id: HISTORY_TAB } };
  const embedded = { id, frameId: 1, url: `chrome-extension://${id}/history.html?server=1&embedded=1`, tab: { id: HISTORY_TAB, url: `chrome-extension://${id}/dashboard.html` } };
  const send = (message: Reply, sender: unknown) => new Promise<Reply>(resolve => listener!(message, sender, resolve as (value: unknown) => void));
  const command = (type: string, platform = "JUNGOL") => send({ type, platform }, historyPage);
  const startImport = (platform = "JUNGOL") => send({ type: "LOCAL_HISTORY_IMPORT_START", platform, submissionIds: ["101"], serverRunId: RUN_ID, serverAccount: "17:100" }, embedded);
  const owned = () => stored["codearchive-owned-history-tab"] as { tabId: number; foregrounded?: boolean; ownWindow?: boolean } | undefined;
  /** The user clicks the history page: its tab is active in its window and that window is focused. */
  const goToHistoryPage = () => { deactivateSiblings(HISTORY_WINDOW); tabs.get(HISTORY_TAB)!.active = true; focusWindow(HISTORY_WINDOW); };
  return { tabs, windows, activated, removed, created, windowCreates, focusedWindows, state, command, startImport, owned, goToHistoryPage, focusWindow };
}

let shared: ReturnType<typeof harness> | undefined;
const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
const realNow = Date.now;
let clockSource: { clock: number } | undefined;
Date.now = () => clockSource?.clock ?? realNow();
test.after(() => { Object.assign(globalThis, previous); Date.now = realNow; });

async function fresh() {
  shared ??= harness();
  const h = await shared;
  clockSource = h.state;
  h.activated.length = 0; h.removed.length = 0; h.created.length = 0; h.windowCreates.length = 0; h.focusedWindows.length = 0;
  h.state.windowsEnabled = true;
  h.goToHistoryPage();
  return h;
}

test("a SWEA list tab that stands still in the background is brought forward once and the user is handed back at the end", async () => {
  const h = await fresh();
  h.state.reply = scanning(22);
  assert.equal((await h.command("LOCAL_HISTORY_SCAN_START", "SWEA")).status, "SCANNING");
  const ownedTabId = h.owned()!.tabId;
  assert.equal(h.created.at(-1)?.active, false, "SWEA and Programmers lists still open in the background");
  assert.equal(h.tabs.get(ownedTabId)!.active, false);
  assert.deepEqual(h.windowCreates, [], "they never get a window of their own");

  // Waiting a little is normal and leaves the user where they are.
  h.state.clock += OWNED_TAB_STALL_MS - 1_000;
  assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).sourceForegrounded, undefined);
  assert.deepEqual(h.activated, []);

  // Nothing moved for the whole window: the site is not answering a background tab.
  h.state.clock += 1_000;
  const stalled = await h.command("LOCAL_HISTORY_STATUS", "SWEA");
  assert.equal(stalled.sourceForegrounded, true);
  assert.equal(stalled.sourceStalled, undefined);
  assert.deepEqual(h.activated, [ownedTabId]);
  assert.equal(h.tabs.get(ownedTabId)!.active, true);
  assert.equal(h.owned()!.foregrounded, true);

  // While it is in front the note stays, and the tab is not touched again.
  h.state.clock += OWNED_TAB_STALL_MS * 2;
  assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).sourceForegrounded, true);
  assert.deepEqual(h.activated, [ownedTabId]);

  // The user goes back to the history page: the stall is reported, not forced.
  h.goToHistoryPage();
  h.state.clock += OWNED_TAB_STALL_MS;
  const reported = await h.command("LOCAL_HISTORY_STATUS", "SWEA");
  assert.equal(reported.sourceStalled, true);
  assert.equal(reported.sourceForegrounded, true);
  assert.deepEqual(h.activated, [ownedTabId]);

  // Progress clears the stall; finishing while the user is on the source tab returns them.
  h.state.reply = scanning(52);
  h.state.clock += OWNED_TAB_STALL_MS * 2;
  assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).sourceStalled, undefined);
  h.tabs.get(HISTORY_TAB)!.active = false; h.tabs.get(ownedTabId)!.active = true;
  h.state.reply = { status: "DONE", completed: 3, total: 3, saved: 3, duplicate: 0, skipped: 0 };
  assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).status, "DONE");
  assert.deepEqual(h.removed, [ownedTabId]);
  assert.equal(h.owned(), undefined);
  assert.deepEqual(h.activated, [ownedTabId, HISTORY_TAB]);
  assert.equal(h.tabs.get(HISTORY_TAB)!.active, true);
});

test("a background list that keeps moving never takes the user's tab, and a finished run does not pull them back from elsewhere", async () => {
  const h = await fresh();
  h.state.reply = scanning(22);
  assert.equal((await h.command("LOCAL_HISTORY_SCAN_START", "SWEA")).status, "SCANNING");
  const ownedTabId = h.owned()!.tabId;

  for (let rows = 52; rows <= 202; rows += 50) {
    h.state.reply = scanning(rows);
    h.state.clock += OWNED_TAB_STALL_MS - 1_000;
    assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).sourceForegrounded, undefined);
  }
  assert.deepEqual(h.activated, []);
  assert.equal(h.owned()!.foregrounded, undefined);

  // Foregrounded, then the user moves on to an unrelated tab before it ends.
  h.state.clock += OWNED_TAB_STALL_MS;
  assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).sourceForegrounded, true);
  assert.deepEqual(h.activated, [ownedTabId]);
  h.tabs.set(99, { id: 99, url: "https://example.com/", status: "complete", active: false, windowId: HISTORY_WINDOW });
  h.tabs.get(ownedTabId)!.active = false; h.tabs.get(99)!.active = true;
  h.state.reply = { status: "DONE", completed: 1, total: 1, saved: 1, duplicate: 0, skipped: 0 };
  assert.equal((await h.command("LOCAL_HISTORY_STATUS", "SWEA")).status, "DONE");
  assert.deepEqual(h.removed, [ownedTabId]);
  assert.deepEqual(h.activated, [ownedTabId], "the history page is not activated over the tab the user chose");
  assert.equal(h.tabs.get(99)!.active, true);
  h.tabs.delete(99);
});

test("Jungol gets a window of its own beside the history page, whose tab stays active, and the window is brought forward whenever it is covered", async () => {
  const h = await fresh();
  h.state.reply = scanning(22);
  assert.equal((await h.command("LOCAL_HISTORY_SCAN_START")).status, "SCANNING");
  const ownedTabId = h.owned()!.tabId;
  const sourceWindow = h.tabs.get(ownedTabId)!.windowId;
  assert.notEqual(sourceWindow, HISTORY_WINDOW, "Jungol is not opened as a tab of the history page's window");
  assert.deepEqual(h.created, [], "no tab is created in the history page's window");
  assert.deepEqual(h.windowCreates, [{ url: "https://jungol.co.kr/", type: "normal", focused: true, left: 960, top: 0, width: 960, height: 1040 }],
    "the window takes the right half of the history page's window");
  assert.deepEqual(h.owned(), { ...h.owned()!, foregrounded: true, ownWindow: true });
  assert.equal(h.tabs.get(HISTORY_TAB)!.active, true, "the history page keeps its tab active and visible");
  assert.equal(h.windows.get(sourceWindow)!.focused, true);

  // Working in front of the user needs no fallback however long the page takes.
  h.state.clock += OWNED_TAB_STALL_MS * 3;
  const working = await h.command("LOCAL_HISTORY_STATUS");
  assert.equal(working.sourceForegrounded, true);
  assert.equal(working.sourceStalled, undefined);
  assert.deepEqual(h.focusedWindows.filter(window => window === sourceWindow), [sourceWindow], "only the scan start focused it");

  // The user clicks the history page, which covers the window; the window comes back without touching the tab.
  h.focusWindow(HISTORY_WINDOW);
  h.state.clock += 1_000;
  await h.command("LOCAL_HISTORY_STATUS");
  h.state.clock += OWNED_TAB_STALL_MS;
  const covered = await h.command("LOCAL_HISTORY_STATUS");
  assert.equal(covered.sourceForegrounded, true);
  assert.equal(covered.sourceStalled, undefined);
  assert.equal(h.windows.get(sourceWindow)!.focused, true, "the covered Jungol window is brought forward again");
  assert.equal(h.tabs.get(HISTORY_TAB)!.active, true, "the history page's tab is never switched away");

  // The list is ready: the user is handed back to the history page, the window stays for the import.
  h.state.reply = { status: "READY", candidates: [], truncated: false };
  assert.equal((await h.command("LOCAL_HISTORY_STATUS")).status, "READY");
  assert.deepEqual(h.removed, []);
  assert.equal(h.windows.get(HISTORY_WINDOW)!.focused, true);
  assert.equal(h.windows.get(sourceWindow)!.focused, false);

  // Starting the import brings the Jungol window forward again.
  h.state.reply = importing(0);
  assert.equal((await h.startImport()).status, "IMPORTING");
  assert.equal(h.windows.get(sourceWindow)!.focused, true);
  assert.equal(h.tabs.get(HISTORY_TAB)!.active, true);

  // Finishing closes the window and returns focus to the history page.
  h.state.reply = { status: "DONE", completed: 3, total: 3, saved: 3, duplicate: 0, skipped: 0 };
  assert.equal((await h.command("LOCAL_HISTORY_STATUS")).status, "DONE");
  assert.deepEqual(h.removed, [ownedTabId]);
  assert.equal(h.windows.has(sourceWindow), false, "the window closes with its tab");
  assert.equal(h.windows.get(HISTORY_WINDOW)!.focused, true);
});

test("Jungol falls back to a tab in front when a window cannot be created, and then only reports a stall the user caused", async () => {
  const h = await fresh();
  h.state.windowsEnabled = false;
  h.state.reply = scanning(22);
  assert.equal((await h.command("LOCAL_HISTORY_SCAN_START")).status, "SCANNING");
  const ownedTabId = h.owned()!.tabId;
  assert.deepEqual(h.created, [{ url: "https://jungol.co.kr/", active: true }]);
  assert.equal(h.owned()!.ownWindow, false);
  assert.equal(h.tabs.get(ownedTabId)!.active, true);

  h.goToHistoryPage();
  h.state.clock += 1_000;
  await h.command("LOCAL_HISTORY_STATUS");
  h.state.clock += OWNED_TAB_STALL_MS;
  const reported = await h.command("LOCAL_HISTORY_STATUS");
  assert.equal(reported.sourceStalled, true);
  assert.equal(h.tabs.get(HISTORY_TAB)!.active, true, "the user's own choice is not overridden");

  h.tabs.get(HISTORY_TAB)!.active = false; h.tabs.get(ownedTabId)!.active = true;
  h.state.reply = { status: "DONE", completed: 1, total: 1, saved: 1, duplicate: 0, skipped: 0 };
  assert.equal((await h.command("LOCAL_HISTORY_STATUS")).status, "DONE");
  assert.equal(h.tabs.get(HISTORY_TAB)!.active, true);
});
