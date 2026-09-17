import { isCaptureRecord } from "./capture";
import { DashboardBridge } from "./bridge";
import { IndexedDbCaptureStore } from "./storage";
import { downloadFilename, exportCode } from "./export";
import { textDownloadUrl } from "./download";
import { recordRelayAttempt, relayCapture, revokeRelay } from "./relay";
import {
  normalizeSweaDetailUrl,
  validateSweaProblemContext
} from "./sweaProblemContext";
import { SWEA_ORIGIN, SWEA_SOLVING_PATH } from "./adapters/sweaSelectors";

const store = new IndexedDbCaptureStore();
const bridge = new DashboardBridge(store, {
  // A refreshed dashboard grant should flush captures that were retained while
  // the old relay was offline or expired instead of waiting for the next alarm.
  onRelayConfigured: () => { void drainRelay().catch(() => undefined); }
});

async function finishSelfRevocation(settings: Awaited<ReturnType<typeof store.getSettings>>): Promise<void> {
  const relay = settings.relay;
  if (!relay || relay.status !== "REVOCATION_PENDING") return;
  const result = await revokeRelay(settings);
  if (result === "ACK") await store.mutateRelayIfCurrent(relay, current => ({ ...current, relay: undefined }));
}

async function drainRelay(): Promise<void> {
  const settings = await store.getSettings();
  if (settings.relay?.status === "REVOCATION_PENDING") {
    await finishSelfRevocation(settings);
    return;
  }
  if (!settings.autoSyncEnabled || !settings.relay) return;
  const next = (await store.listPending([], 1))[0]; if (!next) return;
  const result = await relayCapture(next, settings);
  if (result === "ACK") await store.markSynced([next.captureId]);
  await recordRelayAttempt(store, settings, result);
}
chrome.alarms.create("codearchive-relay-drain", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "codearchive-relay-drain") void drainRelay().catch(() => undefined); });
void drainRelay().catch(() => undefined);

type InternalMessage =
  | { type: "STORE_CAPTURE"; capture: unknown }
  | { type: "GET_POPUP_STATE" }
  | { type: "COPY_RECENT_CAPTURE"; captureId: string }
  | { type: "DOWNLOAD_RECENT_CAPTURE"; captureId: string }
  | { type: "GET_ARCHIVE_STATE" }
  | { type: "UPDATE_ARCHIVE_THEMES"; lightTheme: unknown; darkTheme: unknown }
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

function isPopupSender(sender: chrome.runtime.MessageSender): boolean {
  if (typeof sender.url !== "string") return false;
  try { const url = new URL(sender.url); return url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id && url.pathname === "/popup.html"; } catch { return false; }
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
      .then(async ({ created }) => {
        // Local IndexedDB is always the first commit. Acknowledgement is only
        // returned after remote persistence and does not delete local history.
        if (created) {
          const settings = await store.getSettings();
          const result = await relayCapture(capture, settings);
          if (result === "ACK") await store.markSynced([capture.captureId]);
          await recordRelayAttempt(store, settings, result);
        }
        if (created) void drainRelay().catch(() => undefined);
        sendResponse({ ok: true, created });
      })
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

  if (object.type === "COPY_RECENT_CAPTURE" || object.type === "DOWNLOAD_RECENT_CAPTURE") {
    if (!isPopupSender(sender) || typeof object.captureId !== "string") { sendResponse({ ok: false, error: "UNAUTHORIZED" }); return false; }
    void store.getCapture(object.captureId).then(async capture => {
      if (!capture) return sendResponse({ ok: false, error: "NOT_FOUND" });
      const settings = await store.getSettings(); const text = exportCode(capture, settings.copyHeader === true);
      if (object.type === "COPY_RECENT_CAPTURE") return sendResponse({ ok: true, text });
      const url = textDownloadUrl(exportCode(capture, settings.downloadHeader === true));
      if (!url) return sendResponse({ ok: false, error: "DOWNLOAD_TOO_LARGE" });
      try { await chrome.downloads.download({ url, filename: downloadFilename(capture, settings.downloadFilenameTemplate, { name: settings.name, nickname: settings.nickname, id: settings.accountId }), saveAs: false }); sendResponse({ ok: true }); }
      catch { sendResponse({ ok: false, error: "DOWNLOAD_FAILED" }); }
    }).catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "GET_ARCHIVE_STATE") {
    if (!isArchivePageSender(sender)) {
      sendResponse({ captures: [], error: "UNAUTHORIZED" });
      return false;
    }
    void store
      .listAll()
      .then(async (captures) => sendResponse({ captures, settings: await store.getSettings() }))
      .catch(() => sendResponse({ captures: [], error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "UPDATE_ARCHIVE_THEMES") {
    if (!isArchivePageSender(sender) || typeof object.lightTheme !== "string" || typeof object.darkTheme !== "string") { sendResponse({ ok: false, error: "UNAUTHORIZED" }); return false; }
    const light = ["github-light", "vitesse-light", "catppuccin-latte", "solarized-light", "one-light"];
    const dark = ["github-dark", "vitesse-dark", "catppuccin-mocha", "dracula", "one-dark-pro"];
    if (!light.includes(object.lightTheme) || !dark.includes(object.darkTheme)) { sendResponse({ ok: false, error: "BAD_REQUEST" }); return false; }
    void store.mutateSettings(current => ({ ...current, lightTheme: object.lightTheme as never, darkTheme: object.darkTheme as never }))
      .then(settings => sendResponse({ ok: true, settings }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "UPDATE_SETTINGS") {
    const patch = object.patch;
    if (!patch || typeof patch !== "object") {
      sendResponse({ ok: false, error: "BAD_REQUEST" });
      return false;
    }
    void store.getSettings().then(current => {
      // ON is always dashboard-confirmed through CONFIGURE_RELAY. The popup
      // may only turn automation OFF, which clears the persisted relay now.
      if (patch.autoSyncEnabled === true || Object.prototype.hasOwnProperty.call(patch, "githubAutoCommitEnabled")) return sendResponse({ ok: false, error: "REQUIRES_DASHBOARD" });
      if (patch.autoSyncEnabled !== false) return sendResponse({ ok: true, settings: current });
      return store.mutateSettings(latest => ({ ...latest, autoSyncEnabled: false, githubAutoCommitEnabled: false, ...(latest.relay ? { relay: { ...latest.relay, status: "REVOCATION_PENDING" as const } } : {}) })).then(async pending => {
        await finishSelfRevocation(pending);
        // A dashboard configuration may have won while the bearer revoke was
        // pending; always return the current durable state, never a snapshot.
        sendResponse({ ok: true, settings: await store.getSettings() });
      });
    })
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
      sendResponse({ context: null, error: "INVALID_SWEA_CONTEXT_LOOKUP" });
      return false;
    }
    void store
      .getSweaProblemContext(sourceUrl)
      .then((context) => sendResponse(context ? { context } : { context: null, missing: true }))
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
