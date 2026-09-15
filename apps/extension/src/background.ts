import { isCaptureRecord } from "./capture";
import { DashboardBridge } from "./bridge";
import { IndexedDbCaptureStore } from "./storage";

const store = new IndexedDbCaptureStore();
const bridge = new DashboardBridge(store);

type InternalMessage =
  | { type: "STORE_CAPTURE"; capture: unknown }
  | { type: "GET_POPUP_STATE" }
  | { type: "UPDATE_SETTINGS"; patch: Record<string, unknown> };

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
    void Promise.all([store.countPending(), store.getSettings()])
      .then(([pendingCount, settings]) => sendResponse({ pendingCount, settings }))
      .catch(() => sendResponse({ pendingCount: 0, settings: null, error: "STORAGE_ERROR" }));
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
