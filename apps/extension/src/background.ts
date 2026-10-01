import { isCaptureRecord, isUuid } from "./capture";
import { DashboardBridge } from "./bridge";
import { IndexedDbCaptureStore } from "./storage";
import { loadPopupLocalState, prepareCaptureDownload, retryRelayConnection, storeCaptureLocalFirst } from "./backgroundActions";
import { exportCode } from "./export";
import { normalizedHeaderFields } from "../../../shared/headerFields";
import { fetchGithubCommitStatuses, recordRelayAttempt, relayCapture, revokeRelay } from "./relay";
import {
  normalizeSweaDetailUrl,
  validateSweaProblemContext
} from "./sweaProblemContext";
import { SWEA_ORIGIN, SWEA_SOLVING_PATH } from "./adapters/sweaSelectors";
import { activeSubmissionProgress, SUBMISSION_PROGRESS_KEY, updateSubmissionProgress } from "./submissionProgress";
import type { Platform } from "./types";
import { isJungolHistoryPath } from "./historicalJungol";
import { mayRediscoverHistorySource, mayStoreHistoricalFromSender, sameHistorySource, type LocalHistoryCommand } from "./historyRouting";
import { requestLocalHistoryMessage } from "./localHistoryConnection";

const store = new IndexedDbCaptureStore();
const bridge = new DashboardBridge(store, {
  // A refreshed dashboard grant should flush captures that were retained while
  // the old relay was offline or expired instead of waiting for the next alarm.
  onRelayConfigured: requestRelayDrain,
  onHistoryPreview: platform => requestHistoryTab(platform, { type: "HISTORY_PREVIEW" }),
  onHistoryScanStart: () => requestHistoryTab("JUNGOL", { type: "HISTORY_SCAN_START" }),
  onHistoryScanStatus: () => requestHistoryTab("JUNGOL", { type: "HISTORY_SCAN_STATUS" }),
  onHistoryImport: requestHistoryImport,
  onOpenHistory: openHistoryPage
});

const LOCAL_HISTORY_ROUTE_KEY = "codearchive-local-history-route";
type LocalHistoryRoute = { tabId: number; url: string; status: string };

async function openHistoryPage(): Promise<{ status: "OPENED" }> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
  return { status: "OPENED" };
}

async function readLocalHistoryRoute(): Promise<LocalHistoryRoute | null> {
  const value = (await chrome.storage.session.get(LOCAL_HISTORY_ROUTE_KEY))[LOCAL_HISTORY_ROUTE_KEY];
  if (!value || typeof value !== "object") return null;
  const route = value as Partial<LocalHistoryRoute>;
  return Number.isSafeInteger(route.tabId) && route.tabId! >= 0 && typeof route.url === "string" && route.url.length <= 2_000 && typeof route.status === "string" ? route as LocalHistoryRoute : null;
}

async function writeLocalHistoryRoute(route: LocalHistoryRoute | null): Promise<void> {
  if (route) await chrome.storage.session.set({ [LOCAL_HISTORY_ROUTE_KEY]: route });
  else await chrome.storage.session.remove(LOCAL_HISTORY_ROUTE_KEY);
}

async function resolveLocalHistoryTab(allowNewSource = false): Promise<{ tabId: number; url: string } | { error: "TAB_NOT_FOUND" | "MULTIPLE_TABS" }> {
  const route = await readLocalHistoryRoute();
  if (route) {
    try {
      const tab = await chrome.tabs.get(route.tabId);
      if (tab.url && sameHistorySource(route.url, tab.url)) return { tabId: route.tabId, url: route.url };
    } catch { /* The saved source tab was closed. */ }
    await writeLocalHistoryRoute({ ...route, status: "INTERRUPTED" });
    if (!allowNewSource) return { error: "TAB_NOT_FOUND" };
    await writeLocalHistoryRoute(null);
  }
  // A status read must never bind an arbitrary currently-open source tab.
  // Only a user initiated scan is allowed to choose a new source route.
  if (!allowNewSource) return { error: "TAB_NOT_FOUND" };
  const tabs = await chrome.tabs.query({ url: "https://jungol.co.kr/*" });
  const matches = tabs.filter(tab => Number.isSafeInteger(tab.id) && tab.url && (() => {
    try { const url = new URL(tab.url!); return isJungolHistoryPath(url.pathname); } catch { return false; }
  })());
  if (matches.length !== 1) return { error: matches.length === 0 ? "TAB_NOT_FOUND" : "MULTIPLE_TABS" };
  const match = matches[0]!;
  return { tabId: match.id!, url: match.url! };
}

let localHistoryCommands: Promise<unknown> = Promise.resolve();
function localHistoryCommand(type: LocalHistoryCommand, submissionIds?: string[]): Promise<unknown> {
  // Serialize connection setup so simultaneous clicks cannot inject two listeners.
  const command = localHistoryCommands.catch(() => undefined).then(() => runLocalHistoryCommand(type, submissionIds));
  localHistoryCommands = command;
  return command;
}

async function runLocalHistoryCommand(type: LocalHistoryCommand, submissionIds?: string[]): Promise<unknown> {
  const target = await resolveLocalHistoryTab(mayRediscoverHistorySource(type));
  if ("error" in target) return { status: target.error };
  try {
    const response = await requestLocalHistoryMessage(target, submissionIds ? { type, submissionIds } : { type }, {
      send: (tabId, message) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
      currentUrl: async tabId => (await chrome.tabs.get(tabId)).url,
      connect: tabId => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED" })
    }) as { status?: unknown };
    const status = typeof response?.status === "string" ? response.status : "FAILED";
    await writeLocalHistoryRoute({ ...target, status });
    return response;
  } catch {
    await writeLocalHistoryRoute({ ...target, status: "INTERRUPTED" });
    return { status: "INTERRUPTED" };
  }
}

let historyImportInFlight = false;
async function requestHistoryImport(submissionIds: string[]): Promise<unknown> {
  const route = await readLocalHistoryRoute();
  if (route?.status === "SCANNING" || route?.status === "IMPORTING") return { status: "BUSY" };
  if (historyImportInFlight) return { status: "BUSY" };
  historyImportInFlight = true;
  try { return await requestHistoryTab("JUNGOL", { type: "HISTORY_IMPORT", submissionIds }); }
  finally { historyImportInFlight = false; }
}

async function requestHistoryTab(platform: "SWEA" | "JUNGOL" | "PROGRAMMERS", message: object): Promise<unknown> {
  const path = platform === "SWEA" ? "/main/userpage/code/userSubmitProblem.do" :
    platform === "PROGRAMMERS" ? "/learn/challenges" : "/submission";
  const origin = platform === "SWEA" ? "https://swexpertacademy.com" :
    platform === "PROGRAMMERS" ? "https://school.programmers.co.kr" : "https://jungol.co.kr";
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const matches = tabs.filter(tab => {
    if (!Number.isSafeInteger(tab.id) || !tab.url) return false;
    try { const url = new URL(tab.url); return url.origin === origin &&
      (platform === "JUNGOL" ? isJungolHistoryPath(url.pathname) : url.pathname === path); }
    catch { return false; }
  });
  if (matches.length !== 1) return { status: matches.length === 0 ? "TAB_NOT_FOUND" : "MULTIPLE_TABS" };
  return chrome.tabs.sendMessage(matches[0]!.id!, message, { frameId: 0 });
}

async function finishSelfRevocation(settings: Awaited<ReturnType<typeof store.getSettings>>): Promise<void> {
  const relay = settings.relay;
  if (!relay || relay.status !== "REVOCATION_PENDING") return;
  const result = await revokeRelay(settings);
  if (result === "ACK") await store.mutateRelayIfCurrent(relay, current => ({ ...current, relay: undefined }));
}

async function drainRelay(): Promise<void> {
  let settings = await store.getSettings();
  if (settings.relay?.status === "REVOCATION_PENDING") {
    await finishSelfRevocation(settings);
    return;
  }
  if (!settings.autoSyncEnabled || !settings.relay) return;
  while (true) {
    const next = (await store.listPending([], 1))[0];
    if (!next) return;
    const result = await relayCapture(next, settings);
    if (result === "ACK") await store.markSynced([next.captureId]);
    await recordRelayAttempt(store, settings, result);
    if (result !== "ACK") return;
    settings = await store.getSettings();
    if (!settings.autoSyncEnabled || settings.relay?.status !== "CONFIRMED") return;
  }
}

let relayDrainPromise: Promise<void> | null = null;
let relayDrainRequested = false;

function requestRelayDrain(): Promise<void> {
  relayDrainRequested = true;
  if (!relayDrainPromise) {
    relayDrainPromise = (async () => {
      do {
        relayDrainRequested = false;
        await drainRelay();
      } while (relayDrainRequested);
    })()
      .catch(() => undefined)
      .finally(() => {
        relayDrainPromise = null;
        if (relayDrainRequested) void requestRelayDrain();
      });
  }
  return relayDrainPromise;
}

async function autoDownloadCapture(capture: Parameters<typeof store.putCapture>[0]): Promise<void> {
  const settings = await store.getSettings();
  if (!settings.autoDownloadEnabled) return;
  const download = prepareCaptureDownload(capture, settings);
  if (!download) return;
  await chrome.downloads.download({
    url: download.url,
    filename: download.filename,
    conflictAction: "uniquify",
    saveAs: false
  });
}

function requestPostCaptureWork(capture: Parameters<typeof store.putCapture>[0]): void {
  requestRelayDrain();
  void autoDownloadCapture(capture).catch(() => undefined);
}
chrome.alarms.create("codearchive-relay-drain", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "codearchive-relay-drain") requestRelayDrain(); });
requestRelayDrain();

type InternalMessage =
  | { type: "STORE_CAPTURE"; capture: unknown }
  | { type: "STORE_HISTORICAL_CAPTURE"; capture: unknown }
  | { type: "SET_SUBMISSION_PROGRESS"; attemptId: unknown; platform?: unknown; problemNumber?: unknown; title?: unknown; phase: unknown }
  | { type: "GET_POPUP_STATE" }
  | { type: "RETRY_RELAY" }
  | { type: "GET_GITHUB_COMMIT_STATUSES"; captureIds: unknown }
  | { type: "COPY_RECENT_CAPTURE"; captureId: string }
  | { type: "DOWNLOAD_RECENT_CAPTURE"; captureId: string }
  | { type: "GET_ARCHIVE_STATE" }
  | { type: "UPDATE_ARCHIVE_THEMES"; lightTheme: unknown; darkTheme: unknown }
  | { type: "UPDATE_SETTINGS"; patch: Record<string, unknown> }
  | { type: "STORE_SWEA_PROBLEM_CONTEXT"; context: unknown }
  | { type: "GET_SWEA_PROBLEM_CONTEXT"; sourceUrl: unknown }
  | { type: "OPEN_LOCAL_HISTORY" }
  | { type: "LOCAL_HISTORY_IDS" }
  | { type: "LOCAL_HISTORY_SCAN_START" | "LOCAL_HISTORY_STATUS" | "LOCAL_HISTORY_CANCEL" }
  | { type: "LOCAL_HISTORY_IMPORT_START"; submissionIds: unknown };

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

function isHistoryPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || typeof sender.url !== "string") return false;
  try { const url = new URL(sender.url); return url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id && url.pathname === "/history.html"; }
  catch { return false; }
}

function senderUrl(sender: chrome.runtime.MessageSender): URL | null {
  if (typeof sender.url !== "string") return null;
  try { return new URL(sender.url); } catch { return null; }
}

function isSweaSolvingPageSender(sender: chrome.runtime.MessageSender): boolean {
  const url = senderUrl(sender);
  return !!url && url.origin === SWEA_ORIGIN && url.pathname === SWEA_SOLVING_PATH;
}

function isSupportedCaptureSender(sender: chrome.runtime.MessageSender, platform: Platform): boolean {
  const url = senderUrl(sender);
  if (!url || !Number.isSafeInteger(sender.tab?.id) || sender.frameId !== 0) return false;
  if (platform === "SWEA") return url.origin === SWEA_ORIGIN && url.pathname === SWEA_SOLVING_PATH;
  if (platform === "PROGRAMMERS") return url.origin === "https://school.programmers.co.kr" && /^\/learn\/courses\/30\/lessons\/\d+$/.test(url.pathname);
  return url.origin === "https://jungol.co.kr" && /^\/problem\/\d+$/.test(url.pathname);
}

let progressWrite: Promise<void> = Promise.resolve();
function mutateProgress(update: Parameters<typeof updateSubmissionProgress>[1]): Promise<void> {
  progressWrite = progressWrite.catch(() => undefined).then(async () => {
    const current = (await chrome.storage.session.get(SUBMISSION_PROGRESS_KEY))[SUBMISSION_PROGRESS_KEY];
    await chrome.storage.session.set({ [SUBMISSION_PROGRESS_KEY]: updateSubmissionProgress(current, update) });
  });
  return progressWrite;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const object = asObject(message) as Partial<InternalMessage> | null;
  if (!object?.type) return false;

  if (object.type === "STORE_CAPTURE") {
    const capture = object.capture;
    if (!isCaptureRecord(capture) || capture.historicalImport === true) {
      sendResponse({ ok: false, error: "INVALID_CAPTURE" });
      return false;
    }
    void storeCaptureLocalFirst(store, capture, () => requestPostCaptureWork(capture))
      .then(({ created }) => sendResponse({ ok: true, created }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "STORE_HISTORICAL_CAPTURE") {
    const capture = object.capture;
    const url = senderUrl(sender);
    if (!isCaptureRecord(capture) || capture.historicalImport !== true || capture.platform !== "JUNGOL" ||
        !url || url.origin !== "https://jungol.co.kr" || sender.id !== chrome.runtime.id ||
        !Number.isSafeInteger(sender.tab?.id) || sender.frameId !== 0) {
      sendResponse({ ok: false, error: "INVALID_HISTORICAL_CAPTURE" });
      return false;
    }
    // Historical imports remain local until a separate, explicit upload action.
    void (async () => {
      // The import start replies before its first async store. Wait for the
      // owning route write, without waiting for the content-owned import itself.
      await localHistoryCommands.catch(() => undefined);
      const tabId = sender.tab!.id!;
      const currentUrl = (await chrome.tabs.get(tabId)).url;
      const route = await readLocalHistoryRoute();
      if (!currentUrl || !mayStoreHistoricalFromSender(url.href, currentUrl, tabId, route)) {
        sendResponse({ ok: false, error: "INVALID_HISTORICAL_CAPTURE" });
        return;
      }
      const { created } = await store.putCapture(capture);
      sendResponse({ ok: true, created });
    })()
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "SET_SUBMISSION_PROGRESS") {
    const tabId = sender.tab?.id;
    const platform = object.platform;
    const phase = object.phase;
    if (!Number.isSafeInteger(tabId) || typeof object.attemptId !== "string" || !/^[0-9a-f-]{36}$/i.test(object.attemptId) ||
        (platform !== "SWEA" && platform !== "PROGRAMMERS" && platform !== "JUNGOL") ||
        !isSupportedCaptureSender(sender, platform) ||
        (phase !== "CAPTURING" && phase !== "SAVING" && phase !== "CLEAR") ||
        (phase === "CAPTURING" && (typeof object.problemNumber !== "string" || !/^\d{1,40}$/.test(object.problemNumber) ||
          typeof object.title !== "string" || !object.title.trim() || object.title.length > 200))) {
      sendResponse({ ok: false, error: "BAD_REQUEST" });
      return false;
    }
    void mutateProgress({ tabId: tabId!, attemptId: object.attemptId, platform, problemNumber: object.problemNumber as string | undefined, title: object.title as string | undefined, phase })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "GET_POPUP_STATE") {
    void Promise.all([loadPopupLocalState(store), chrome.storage.session.get(SUBMISSION_PROGRESS_KEY).catch(() => ({} as Record<string, unknown>))])
      .then(([state, progress]) => sendResponse({ ...state, submissionProgress: activeSubmissionProgress(progress[SUBMISSION_PROGRESS_KEY]) }))
      .catch(() => sendResponse({ pendingCount: 0, settings: null, recentCaptures: [], error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "OPEN_LOCAL_HISTORY") {
    if (!isPopupSender(sender) && !isArchivePageSender(sender)) { sendResponse({ ok: false, error: "UNAUTHORIZED" }); return false; }
    void openHistoryPage().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false, error: "OPEN_FAILED" }));
    return true;
  }

  if (object.type === "LOCAL_HISTORY_IDS") {
    if (!isHistoryPageSender(sender)) { sendResponse({ error: "UNAUTHORIZED" }); return false; }
    void store.listHistoricalSubmissionIds("JUNGOL").then(submissionIds => sendResponse({ submissionIds })).catch(() => sendResponse({ error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "LOCAL_HISTORY_SCAN_START" || object.type === "LOCAL_HISTORY_STATUS" || object.type === "LOCAL_HISTORY_CANCEL" || object.type === "LOCAL_HISTORY_IMPORT_START") {
    if (!isHistoryPageSender(sender)) { sendResponse({ status: "UNAUTHORIZED" }); return false; }
    const ids = object.type === "LOCAL_HISTORY_IMPORT_START" ? object.submissionIds : undefined;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > 5_000 || ids.some(id => typeof id !== "string" || !/^\d{1,40}$/.test(id)) || new Set(ids).size !== ids.length)) { sendResponse({ status: "BAD_REQUEST" }); return false; }
    void localHistoryCommand(object.type, ids as string[] | undefined).then(sendResponse).catch(() => sendResponse({ status: "FAILED" }));
    return true;
  }

  if (object.type === "RETRY_RELAY") {
    if (!isPopupSender(sender)) {
      sendResponse({ ok: false, error: "UNAUTHORIZED" });
      return false;
    }
    void retryRelayConnection(store, requestRelayDrain)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "GET_GITHUB_COMMIT_STATUSES") {
    if (!isPopupSender(sender) || !Array.isArray(object.captureIds)) {
      sendResponse({ statuses: {}, error: "UNAUTHORIZED" });
      return false;
    }
    const captureIds = [...new Set(object.captureIds.filter(isUuid))].slice(0, 10);
    void store.getSettings()
      .then(settings => fetchGithubCommitStatuses(captureIds, settings))
      .then(statuses => sendResponse({ statuses }))
      .catch(() => sendResponse({ statuses: {} }));
    return true;
  }

  if (object.type === "COPY_RECENT_CAPTURE" || object.type === "DOWNLOAD_RECENT_CAPTURE") {
    if (!isPopupSender(sender) || typeof object.captureId !== "string") { sendResponse({ ok: false, error: "UNAUTHORIZED" }); return false; }
    void store.getCapture(object.captureId).then(async capture => {
      if (!capture) return sendResponse({ ok: false, error: "NOT_FOUND" });
      const settings = await store.getSettings(); const text = exportCode(capture, settings.copyHeader === true, normalizedHeaderFields(settings.copyHeaderFields));
      if (object.type === "COPY_RECENT_CAPTURE") return sendResponse({ ok: true, text });
      const download = prepareCaptureDownload(capture, settings);
      if (!download) return sendResponse({ ok: false, error: "DOWNLOAD_TOO_LARGE" });
      try { await chrome.downloads.download({ url: download.url, filename: download.filename, conflictAction: "uniquify", saveAs: false }); sendResponse({ ok: true }); }
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
    const hasAutoDownload = Object.prototype.hasOwnProperty.call(patch, "autoDownloadEnabled");
    if (hasAutoDownload && typeof patch.autoDownloadEnabled !== "boolean") {
      sendResponse({ ok: false, error: "BAD_REQUEST" });
      return false;
    }
    void store.getSettings().then(current => {
      // ON is always dashboard-confirmed through CONFIGURE_RELAY. The popup
      // may only turn automation OFF, which clears the persisted relay now.
      if (patch.autoSyncEnabled === true || Object.prototype.hasOwnProperty.call(patch, "githubAutoCommitEnabled")) return sendResponse({ ok: false, error: "REQUIRES_DASHBOARD" });
      if (patch.autoSyncEnabled !== false) {
        if (!hasAutoDownload) return sendResponse({ ok: true, settings: current });
        return store.mutateSettings(latest => ({ ...latest, autoDownloadEnabled: patch.autoDownloadEnabled as boolean }))
          .then(settings => sendResponse({ ok: true, settings }));
      }
      return store.mutateSettings(latest => ({ ...latest, ...(hasAutoDownload ? { autoDownloadEnabled: patch.autoDownloadEnabled as boolean } : {}), autoSyncEnabled: false, githubAutoCommitEnabled: false, ...(latest.relay ? { relay: { ...latest.relay, status: "REVOCATION_PENDING" as const } } : {}) })).then(async pending => {
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
