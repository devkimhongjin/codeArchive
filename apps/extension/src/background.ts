import { isCaptureRecord } from "./capture";
import { DashboardBridge } from "./bridge";
import { IndexedDbCaptureStore } from "./storage";
import {
  normalizeSweaDetailUrl,
  validateSweaProblemContext
} from "./sweaProblemContext";
import { SWEA_ORIGIN, SWEA_SOLVING_PATH } from "./adapters/sweaSelectors";

const store = new IndexedDbCaptureStore();
const bridge = new DashboardBridge(store);

type InternalMessage =
  | { type: "STORE_CAPTURE"; capture: unknown }
  | { type: "GET_POPUP_STATE" }
  | { type: "GET_ARCHIVE_STATE" }
  | { type: "UPDATE_SETTINGS"; patch: Record<string, unknown> }
  | { type: "STORE_SWEA_PROBLEM_CONTEXT"; context: unknown }
  | { type: "GET_SWEA_PROBLEM_CONTEXT"; sourceUrl: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isArchivePageSender(sender: chrome.runtime.MessageSender): boolean {
  if (typeof sender.url !== "string") return false;
  try {
    const senderUrl = new URL(sender.url);
    return senderUrl.protocol === "chrome-extension:" &&
      senderUrl.hostname === chrome.runtime.id &&
      senderUrl.pathname === "/archive.html" &&
      (!sender.id || sender.id === chrome.runtime.id);
  } catch {
    return false;
  }
}

function senderUrl(sender: chrome.runtime.MessageSender): URL | null {
  if (typeof sender.url !== "string") return null;
  try { return new URL(sender.url); } catch { return null; }
}

function isSweaSolvingPageSender(sender: chrome.runtime.MessageSender): boolean {
  const url = senderUrl(sender);
  return !!url && url.origin === SWEA_ORIGIN && url.pathname === SWEA_SOLVING_PATH;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const object = asObject(message) as Partial<InternalMessage> | null;
  if (!object?.type) return false;

  if (object.type === "STORE_CAPTURE") {
    const capture = object.capture;
    if (!isCaptureRecord(capture)) {
      sendResponse({ ok: false, error: "INVALID_CAPTURE" });
      return false;
    }
    void store
      .putCapture(capture)
      .then(({ created }) => sendResponse({ ok: true, created }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "GET_POPUP_STATE") {
    void Promise.all([store.countPending(), store.getSettings(), store.listAll(3)])
      .then(([pendingCount, settings, recentCaptures]) => sendResponse({
        pendingCount,
        settings,
        // The popup only needs metadata. Keep source code in the archive page's
        // extension-internal response so it never crosses the dashboard bridge.
        recentCaptures: recentCaptures.map(({ sourceCode: _sourceCode, ...preview }) => preview)
      }))
      .catch(() => sendResponse({ pendingCount: 0, settings: null, recentCaptures: [], error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "GET_ARCHIVE_STATE") {
    if (!isArchivePageSender(sender)) {
      sendResponse({ captures: [], error: "UNAUTHORIZED" });
      return false;
    }
    void store
      .listAll()
      .then((captures) => sendResponse({ captures }))
      .catch(() => sendResponse({ captures: [], error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "UPDATE_SETTINGS") {
    const patch = object.patch;
    if (!patch || typeof patch !== "object") {
      sendResponse({ ok: false, error: "BAD_REQUEST" });
      return false;
    }
    const safePatch = {
      ...(patch.autoSyncEnabled === true || patch.autoSyncEnabled === false
        ? { autoSyncEnabled: patch.autoSyncEnabled }
        : {}),
      // This flag can only be enabled by a future server/dashboard target. The
      // extension contains no GitHub credentials and cannot make it true.
      ...(patch.githubAutoCommitEnabled === false ? { githubAutoCommitEnabled: false } : {})
    };
    void store
      .updateSettings(safePatch)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "STORE_SWEA_PROBLEM_CONTEXT") {
    const context = validateSweaProblemContext(object.context);
    const sourceUrl = typeof sender.url === "string" ? normalizeSweaDetailUrl(sender.url) : null;
    if (!context || sourceUrl !== context.problemUrl) {
      sendResponse({ ok: false, error: "INVALID_SWEA_CONTEXT" });
      return false;
    }
    void store
      .putSweaProblemContext(context)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "GET_SWEA_PROBLEM_CONTEXT") {
    const sourceUrl = typeof object.sourceUrl === "string" ? normalizeSweaDetailUrl(object.sourceUrl) : null;
    if (!sourceUrl || !isSweaSolvingPageSender(sender)) {
      sendResponse({ context: null });
      return false;
    }
    void store
      .getSweaProblemContext(sourceUrl)
      .then((context) => sendResponse({ context }))
      .catch(() => sendResponse({ context: null, error: "STORAGE_ERROR" }));
    return true;
  }

  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void bridge
    .handleMessage(message, {
      url: sender.url,
      documentId: sender.documentId,
      frameId: sender.frameId,
      tab: sender.tab ? { id: sender.tab.id, url: sender.tab.url } : undefined
    })
    .then(sendResponse)
    .catch(() => sendResponse({ error: "BAD_REQUEST" }));
  return true;
});
