import { loadReconciliationEvidence } from './reconciliationEvidence';
import { isLightTheme, isDarkTheme } from "../../../shared/codeThemes";
import { setPopupGithubAutomation } from './popupGithubAutomation';
import { isCaptureRecord, isUuid } from "./capture";
import { DashboardBridge } from "./bridge";
import { dashboardSender, dashboardExternalUrl, validDashboardLoginNonce, beginDashboardLogin, completeDashboardLogin } from './dashboardNavigation';
import { IndexedDbCaptureStore } from "./storage";
import { bindAutomaticCapture, nextAutomaticCapture, loadPopupLocalState, prepareCaptureDownload, retryRelayConnection, storeCaptureLocalFirst } from "./backgroundActions";
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
import { isHistoricalSubmissionId } from "./historicalIdentity";
import { historyPlatformForUrl, isLocalHistoryPageSender, mayRediscoverHistorySource, mayStoreHistoricalFromSender, sameHistorySource, type LocalHistoryCommand } from "./historyRouting";
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
// Remove only the legacy app reconnect alarm; stored pairing/data remain intact.
void chrome.alarms.clear('codearchive-desktop-reconnect');
type LocalHistoryRoute = { tabId: number; url: string; status: string; platform: Platform };

async function openHistoryPage(): Promise<{ status: "OPENED" }> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
  return { status: "OPENED" };
}

async function readLocalHistoryRoute(): Promise<LocalHistoryRoute | null> {
  const value = (await chrome.storage.session.get(LOCAL_HISTORY_ROUTE_KEY))[LOCAL_HISTORY_ROUTE_KEY];
  if (!value || typeof value !== "object") return null;
  const route = value as Partial<LocalHistoryRoute>;
  if (typeof route.url !== "string") return null;
  const platform = route.platform === "JUNGOL" || route.platform === "SWEA" || route.platform === "PROGRAMMERS"
    ? route.platform : historyPlatformForUrl(route.url);
  return Number.isSafeInteger(route.tabId) && route.tabId! >= 0 && typeof route.url === "string" && route.url.length <= 2_000 && typeof route.status === "string" && platform
    ? { ...route, platform } as LocalHistoryRoute : null;
}

async function writeLocalHistoryRoute(route: LocalHistoryRoute | null): Promise<void> {
  if (route) await chrome.storage.session.set({ [LOCAL_HISTORY_ROUTE_KEY]: route });
  else await chrome.storage.session.remove(LOCAL_HISTORY_ROUTE_KEY);
}

async function resolveLocalHistoryTab(platform: Platform, allowNewSource = false): Promise<{ tabId: number; url: string; platform: Platform } | { error: "TAB_NOT_FOUND" | "MULTIPLE_TABS" }> {
  const route = await readLocalHistoryRoute();
  if (route) {
    // history.html initially mounts the compatible Jungol view while a different
    // platform task may still be running. Read-only commands for that default
    // view must not inspect, interrupt, or replace the task's saved source.
    // Only an explicit scan is allowed to choose a different platform source.
    if (route.platform !== platform && !allowNewSource) return { error: "TAB_NOT_FOUND" };
    try {
      const tab = await chrome.tabs.get(route.tabId);
      if (route.platform === platform && tab.url && sameHistorySource(route.url, tab.url, platform)) return { tabId: route.tabId, url: route.url, platform };
    } catch { /* The saved source tab was closed. */ }
    await writeLocalHistoryRoute({ ...route, status: "INTERRUPTED" });
    if (!allowNewSource) return { error: "TAB_NOT_FOUND" };
    await writeLocalHistoryRoute(null);
  }
  // A status read must never bind an arbitrary currently-open source tab.
  // Only a user initiated scan is allowed to choose a new source route.
  if (!allowNewSource) return { error: "TAB_NOT_FOUND" };
  const origin = platform === "JUNGOL" ? "https://jungol.co.kr/*" : platform === "SWEA" ? "https://swexpertacademy.com/*" : "https://school.programmers.co.kr/*";
  const tabs = await chrome.tabs.query({ url: origin });
  const matches = tabs.filter(tab => Number.isSafeInteger(tab.id) && tab.url && (() => {
    try { return historyPlatformForUrl(tab.url!) === platform; } catch { return false; }
  })());
  if (matches.length !== 1) return { error: matches.length === 0 ? "TAB_NOT_FOUND" : "MULTIPLE_TABS" };
  const match = matches[0]!;
  return { tabId: match.id!, url: match.url!, platform };
}

let localHistoryCommands: Promise<unknown> = Promise.resolve();
function localHistoryCommand(type: LocalHistoryCommand, platform: Platform = "JUNGOL", submissionIds?: string[]): Promise<unknown> {
  // Serialize connection setup so simultaneous clicks cannot inject two listeners.
  const command = localHistoryCommands.catch(() => undefined).then(() => runLocalHistoryCommand(type, platform, submissionIds));
  localHistoryCommands = command;
  return command;
}

async function runLocalHistoryCommand(type: LocalHistoryCommand, platform: Platform, submissionIds?: string[]): Promise<unknown> {
  const target = await resolveLocalHistoryTab(platform, mayRediscoverHistorySource(type));
  if ("error" in target) return { status: target.error };
  // The content script can request an owned auxiliary tab before this command
  // replies. Persist that intent first, so the auxiliary service has a route
  // to bind to from its very first request.
  const initialStatus = type === "LOCAL_HISTORY_SCAN_START" ? "SCANNING" :
    type === "LOCAL_HISTORY_IMPORT_START" ? "IMPORTING" :
      type === "LOCAL_HISTORY_CANCEL" ? "CANCELLING" : undefined;
  if (initialStatus) await writeLocalHistoryRoute({ ...target, status: initialStatus });
  try {
    const response = await requestLocalHistoryMessage(target, submissionIds ? { type, platform, submissionIds } : { type, platform }, {
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
    const next = nextAutomaticCapture(await store.listAll(), settings);
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

// Chrome Web Store will own updates. Remove the legacy GitHub lookup alarm.
void chrome.alarms.clear('codearchive-extension-update');
chrome.alarms.create("codearchive-relay-drain", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "codearchive-relay-drain") requestRelayDrain(); });
requestRelayDrain();

type InternalMessage =
  | { type: "STORE_CAPTURE"; capture: unknown }
  | { type: "STORE_HISTORICAL_CAPTURE"; capture: unknown }
  | { type: "SET_SUBMISSION_PROGRESS"; attemptId: unknown; platform?: unknown; problemNumber?: unknown; title?: unknown; phase: unknown }
  | { type: "GET_POPUP_STATE" }
  | { type: "SET_GITHUB_AUTOMATION"; enabled: boolean; accountId: string; settingsVersion: number }
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
  | { type: "LOCAL_HISTORY_RECONCILIATION"; platform: unknown }
  | { type: "LOCAL_HISTORY_IDS"; platform?: unknown }
  | { type: "LOCAL_HISTORY_SCAN_START" | "LOCAL_HISTORY_STATUS" | "LOCAL_HISTORY_CANCEL"; platform?: unknown }
  | { type: "LOCAL_HISTORY_IMPORT_START"; platform?: unknown; submissionIds: unknown };

type ProgrammersAuxiliaryMessage = { type: "PROGRAMMERS_AUX_READ"; lessonUrl: unknown; mode: unknown; submissionId?: unknown } | { type: "PROGRAMMERS_AUX_CANCEL" };
type ProgrammersAuxiliaryRun = { sourceTabId: number; generation: number; lessonUrl: string; auxiliaryTabId?: number; cancelled: boolean; cleaned: boolean; interruptRead?: () => void };
const PROGRAMMERS_AUXILIARY_READ_TIMEOUT_MS = 45_000;
class ProgrammersAuxiliaryReadError extends Error {
  constructor(readonly reason: "READ_TIMEOUT" | "INTERRUPTED") { super(reason); }
}
const programmersAuxiliaryRuns = new Map<number, ProgrammersAuxiliaryRun>();
let nextProgrammersAuxiliaryGeneration = 0;

function canonicalProgrammersLessonUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try { const url = new URL(value); return url.origin === "https://school.programmers.co.kr" && !url.search && !url.hash &&
    /^\/learn\/courses\/30\/lessons\/\d{1,40}$/.test(url.pathname) ? url.href : null; } catch { return null; }
}

async function cleanupProgrammersAuxiliary(run: ProgrammersAuxiliaryRun): Promise<void> {
  run.interruptRead?.();
  if (programmersAuxiliaryRuns.get(run.sourceTabId) === run) programmersAuxiliaryRuns.delete(run.sourceTabId);
  // A cancellation may arrive while tabs.create is pending. Keep the cleanup
  // pending until create supplies its id, then finally closes that tab.
  if (!Number.isSafeInteger(run.auxiliaryTabId) || run.cleaned) return;
  run.cleaned = true;
  await chrome.tabs.remove(run.auxiliaryTabId!).catch(() => undefined);
}

/** A frozen content receiver must not hold the source's collection forever. */
async function readProgrammersAuxiliaryMessage(run: ProgrammersAuxiliaryRun, message: unknown): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interruption = new Promise<never>((_, reject) => {
    run.interruptRead = () => reject(new ProgrammersAuxiliaryReadError("INTERRUPTED"));
    timer = setTimeout(() => reject(new ProgrammersAuxiliaryReadError("READ_TIMEOUT")), PROGRAMMERS_AUXILIARY_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([chrome.tabs.sendMessage(run.auxiliaryTabId!, message, { frameId: 0 }), interruption]);
  } finally {
    clearTimeout(timer);
    delete run.interruptRead;
  }
}

async function waitForProgrammersAuxiliaryTab(run: ProgrammersAuxiliaryRun): Promise<"READY" | "INTERRUPTED" | "REDIRECTED" | "OPEN_FAILED"> {
  if (!Number.isSafeInteger(run.auxiliaryTabId)) return "OPEN_FAILED";
  // Cold lesson loads are routinely slower than a second, so keep a bounded
  // twenty-second window while observing cancellation every 100 ms.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (run.cancelled) return "INTERRUPTED";
    let tab: chrome.tabs.Tab;
    try { tab = await chrome.tabs.get(run.auxiliaryTabId!); } catch { return run.cancelled ? "INTERRUPTED" : "OPEN_FAILED"; }
    if (tab.url === run.lessonUrl && tab.status === "complete") return "READY";
    // Chrome can report a newly opened inactive tab as about:blank until its
    // requested navigation commits. That transient state is not a redirect.
    if (tab.url && tab.url !== "about:blank" && tab.url !== run.lessonUrl) return "REDIRECTED";
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  return run.cancelled ? "INTERRUPTED" : "OPEN_FAILED";
}

function isNoProgrammersAuxiliaryReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /receiving end does not exist|could not establish connection|no receiver/i.test(message);
}

function isProgrammersAuxiliarySender(sender: chrome.runtime.MessageSender): sender is chrome.runtime.MessageSender & { tab: chrome.tabs.Tab } {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isSafeInteger(sender.tab?.id);
}

async function programmersListingRoute(sender: chrome.runtime.MessageSender): Promise<LocalHistoryRoute | null> {
  if (!isProgrammersAuxiliarySender(sender) || !sender.url) return null;
  if (historyPlatformForUrl(sender.url) !== "PROGRAMMERS") return null;
  const route = await readLocalHistoryRoute();
  return route && route.platform === "PROGRAMMERS" && route.tabId === sender.tab!.id &&
    (route.status === "SCANNING" || route.status === "IMPORTING") && sameHistorySource(route.url, sender.url, "PROGRAMMERS") ? route : null;
}

async function runProgrammersAuxiliary(sender: chrome.runtime.MessageSender, message: Extract<ProgrammersAuxiliaryMessage, { type: "PROGRAMMERS_AUX_READ" }>): Promise<unknown> {
  const lessonUrl = canonicalProgrammersLessonUrl(message.lessonUrl);
  if (!lessonUrl || (message.mode !== "preview" && message.mode !== "import") ||
      (message.submissionId !== undefined && !isHistoricalSubmissionId("PROGRAMMERS", message.submissionId))) return { ok: false, error: "BAD_REQUEST" };
  const route = await programmersListingRoute(sender); if (!route) return { ok: false, error: "UNAUTHORIZED" };
  const sourceTabId = sender.tab!.id!;
  const prior = programmersAuxiliaryRuns.get(sourceTabId); if (prior) return { ok: false, error: "BUSY" };
  const run: ProgrammersAuxiliaryRun = { sourceTabId, generation: ++nextProgrammersAuxiliaryGeneration, lessonUrl, cancelled: false, cleaned: false }; programmersAuxiliaryRuns.set(sourceTabId, run);
  try {
    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (!Number.isSafeInteger(sourceTab.windowId) || !sourceTab.url || !sameHistorySource(route.url, sourceTab.url, "PROGRAMMERS") || run.cancelled)
      return { ok: false, error: "INTERRUPTED" };
    // Keep auxiliary lessons in the existing source window, leaving the
    // collection window visible. Never create a popup for each problem.
    const created = await chrome.tabs.create({ url: lessonUrl, active: true, windowId: sourceTab.windowId });
    if (!created || !Number.isSafeInteger(created.id)) return { ok: false, error: "OPEN_FAILED" };
    run.auxiliaryTabId = created.id!;
    if (run.cancelled) return { ok: false, error: "INTERRUPTED" };
    const before = await chrome.tabs.get(sourceTabId);
    if (!before.url || run.cancelled || !sameHistorySource(route.url, before.url, "PROGRAMMERS")) return { ok: false, error: "INTERRUPTED" };
    const readiness = await waitForProgrammersAuxiliaryTab(run);
    if (readiness !== "READY") return { ok: false, error: readiness };
    const readMessage = { type: "PROGRAMMERS_AUXILIARY_READ", lessonUrl, mode: message.mode,
      ...(message.submissionId === undefined ? {} : { submissionId: message.submissionId }) };
    let result: unknown;
    try {
      result = await readProgrammersAuxiliaryMessage(run, readMessage);
    } catch (error) {
      if (!isNoProgrammersAuxiliaryReceiver(error)) throw error;
      // Inject at most once after a verified missing-receiver failure. The
      // auxiliary request only reads the selected submission and is sent once
      // after injection; create/navigation are never retried.
      await chrome.scripting.executeScript({ target: { tabId: run.auxiliaryTabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED" });
      if (run.cancelled) return { ok: false, error: "INTERRUPTED" };
      result = await readProgrammersAuxiliaryMessage(run, readMessage);
    }
    const after = await chrome.tabs.get(sourceTabId);
    if (!after.url || run.cancelled || !sameHistorySource(route.url, after.url, "PROGRAMMERS")) return { ok: false, error: "INTERRUPTED" };
    const finalAuxiliary = await chrome.tabs.get(run.auxiliaryTabId);
    if (finalAuxiliary.url !== lessonUrl) return { ok: false, error: "REDIRECTED" };
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error instanceof ProgrammersAuxiliaryReadError ? error.reason : "READ_FAILED" }; }
  finally { await cleanupProgrammersAuxiliary(run); }
}

async function cancelProgrammersAuxiliary(sender: chrome.runtime.MessageSender): Promise<{ ok: boolean }> {
  // Cancellation is allowed only by the extension's top-frame source tab. It
  // deliberately does not require the route to remain current, so a source
  // navigation cannot strand an owned auxiliary tab.
  if (!isProgrammersAuxiliarySender(sender)) return { ok: false };
  const run = programmersAuxiliaryRuns.get(sender.tab.id!);
  if (!run) return { ok: false };
  run.cancelled = true;
  await cleanupProgrammersAuxiliary(run);
  return { ok: true };
}

// The registry represents only tabs created by this service. Browser tab
// events can therefore release a source-bound run without ever touching a
// user tab, including if the source navigates away while an auxiliary read is
// awaiting its receiver.
const backgroundTabs = chrome.tabs as unknown as {
  onRemoved?: { addListener(callback: (tabId: number) => void): void };
  onUpdated?: { addListener(callback: (tabId: number, changeInfo: { url?: string }) => void): void };
};
backgroundTabs.onRemoved?.addListener(tabId => {
  for (const run of programmersAuxiliaryRuns.values()) {
    if (run.sourceTabId === tabId || run.auxiliaryTabId === tabId) {
      run.cancelled = true;
      void cleanupProgrammersAuxiliary(run);
    }
  }
});
backgroundTabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (typeof changeInfo.url !== "string") return;
  for (const run of programmersAuxiliaryRuns.values()) {
    if (run.auxiliaryTabId === tabId && changeInfo.url !== run.lessonUrl) {
      run.cancelled = true;
      void cleanupProgrammersAuxiliary(run);
      continue;
    }
    if (run.sourceTabId === tabId) {
      void readLocalHistoryRoute().then(route => {
        if (!route || route.tabId !== tabId || route.platform !== "PROGRAMMERS" || !sameHistorySource(route.url, changeInfo.url!, "PROGRAMMERS")) {
          run.cancelled = true;
          return cleanupProgrammersAuxiliary(run);
        }
      }).catch(() => undefined);
    }
  }
});

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
  return isLocalHistoryPageSender(sender, chrome.runtime.id);
}

let popupGithubBusy = false;
async function popupRelayDeviceId(): Promise<string> {
  const key = 'codearchive-popup-relay-device-id';
  const saved = (await chrome.storage.local.get(key))[key];
  if (typeof saved === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(saved)) return saved;
  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ [key]: deviceId });
  return deviceId;
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

type AnyInternalMessage = InternalMessage | ProgrammersAuxiliaryMessage;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const dashboardMessage = asObject(message);
  if (dashboardMessage?.type === 'DASHBOARD_REQUEST' || dashboardMessage?.type === 'DASHBOARD_OPEN_EXTERNAL') {
    if (!dashboardSender(sender, chrome.runtime.id)) { sendResponse({ error: 'UNAUTHORIZED' }); return false; }
    if (dashboardMessage.type === 'DASHBOARD_REQUEST') {
      void bridge.handleExtensionMessage(dashboardMessage.message, sender, chrome.runtime.id).then(sendResponse).catch(() => sendResponse({ error: 'BAD_REQUEST' }));
    } else {
      const url = dashboardExternalUrl(dashboardMessage.url);
      if (!url || !validDashboardLoginNonce(dashboardMessage.loginNonce)) { sendResponse({ error: 'BAD_REQUEST' }); return false; }
      void beginDashboardLogin(url, sender.tab!.id!, dashboardMessage.loginNonce).then(() => {
        sendResponse({ ok: true });
      }).catch(() => sendResponse({ error: '로그인 창을 열지 못했습니다.' }));
    }
    return true;
  }
  const object = asObject(message) as Partial<AnyInternalMessage> | null;
  if (!object?.type) return false;

  if (object.type === "PROGRAMMERS_AUX_READ") {
    void runProgrammersAuxiliary(sender, object as ProgrammersAuxiliaryMessage & { type: "PROGRAMMERS_AUX_READ" })
      .then(sendResponse).catch(() => sendResponse({ ok: false, error: "READ_FAILED" }));
    return true;
  }
  if (object.type === "PROGRAMMERS_AUX_CANCEL") {
    void cancelProgrammersAuxiliary(sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (object.type === "STORE_CAPTURE") {
    const capture = object.capture;
    if (!isCaptureRecord(capture) || capture.historicalImport === true) {
      sendResponse({ ok: false, error: "INVALID_CAPTURE" });
      return false;
    }
    void store.getSettings().then(settings => storeCaptureLocalFirst(store, bindAutomaticCapture(capture, settings), requestRelayDrain))
      .then(({ created }) => sendResponse({ ok: true, created }))
      .catch(() => sendResponse({ ok: false, error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "STORE_HISTORICAL_CAPTURE") {
    const capture = object.capture;
    const url = senderUrl(sender);
    if (!isCaptureRecord(capture) || capture.historicalImport !== true || !isHistoricalSubmissionId(capture.platform, capture.historicalSubmissionId) ||
        !url || (capture.platform === "JUNGOL" ? url.origin !== "https://jungol.co.kr" : historyPlatformForUrl(url) !== capture.platform) || sender.id !== chrome.runtime.id ||
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
      if (!currentUrl || (route && route.platform !== capture.platform) ||
          (!route && capture.platform !== "JUNGOL") || !mayStoreHistoricalFromSender(url.href, currentUrl, tabId, route, capture.platform)) {
        sendResponse({ ok: false, error: "INVALID_HISTORICAL_CAPTURE" });
        return;
      }
      const written = await store.putCapture(capture);
      sendResponse({ ok: true, ...written });
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

  if (object.type === 'SET_GITHUB_AUTOMATION') {
    if (!isPopupSender(sender) || sender.id !== chrome.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0)) {
      sendResponse({ ok: false, error: 'UNAUTHORIZED' }); return false;
    }
    if (typeof object.enabled !== 'boolean' || typeof object.accountId !== 'string' || !/^\d{1,40}$/.test(object.accountId) ||
      !Number.isSafeInteger(object.settingsVersion) || (object.settingsVersion as number) < 0) {
      sendResponse({ ok: false, error: 'BAD_REQUEST' }); return false;
    }
    if (popupGithubBusy) { sendResponse({ ok: false, error: 'BUSY' }); return false; }
    popupGithubBusy = true;
    void popupRelayDeviceId().then(deviceId => setPopupGithubAutomation(store, {
      enabled: object.enabled as boolean, accountId: object.accountId as string, settingsVersion: object.settingsVersion as number,
    }, deviceId)).then(result => {
      if (result.ok && result.relayReady) void requestRelayDrain();
      sendResponse(result);
    }).catch(() => sendResponse({ ok: false, error: 'STORAGE_ERROR' })).finally(() => { popupGithubBusy = false; });
    return true;
  }

  if (object.type === "LOCAL_HISTORY_RECONCILIATION") {
    if (!isHistoryPageSender(sender)) { sendResponse({ error: "UNAUTHORIZED" }); return false; }
    if (object.platform !== "SWEA" && object.platform !== "PROGRAMMERS") { sendResponse({ error: "BAD_REQUEST" }); return false; }
    void loadReconciliationEvidence(store, object.platform).then(sendResponse).catch(() => sendResponse({ error: "EVIDENCE_UNAVAILABLE" }));
    return true;
  }

  if (object.type === "LOCAL_HISTORY_IDS") {
    if (!isHistoryPageSender(sender)) { sendResponse({ error: "UNAUTHORIZED" }); return false; }
    const platform = object.platform === undefined ? "JUNGOL" : object.platform;
    if (platform !== "JUNGOL" && platform !== "SWEA" && platform !== "PROGRAMMERS") { sendResponse({ error: "BAD_REQUEST" }); return false; }
    void store.listHistoricalSubmissionIds(platform).then(submissionIds => sendResponse({ submissionIds })).catch(() => sendResponse({ error: "STORAGE_ERROR" }));
    return true;
  }

  if (object.type === "LOCAL_HISTORY_SCAN_START" || object.type === "LOCAL_HISTORY_STATUS" || object.type === "LOCAL_HISTORY_CANCEL" || object.type === "LOCAL_HISTORY_IMPORT_START") {
    if (!isHistoryPageSender(sender)) { sendResponse({ status: "UNAUTHORIZED" }); return false; }
    const platform = object.platform === undefined ? "JUNGOL" : object.platform;
    if (platform !== "JUNGOL" && platform !== "SWEA" && platform !== "PROGRAMMERS") { sendResponse({ status: "BAD_REQUEST" }); return false; }
    const ids = object.type === "LOCAL_HISTORY_IMPORT_START" ? object.submissionIds : undefined;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > 5_000 || ids.some(id => !isHistoricalSubmissionId(platform, id)) || new Set(ids).size !== ids.length)) { sendResponse({ status: "BAD_REQUEST" }); return false; }
    void localHistoryCommand(object.type, platform, ids as string[] | undefined).then(sendResponse).catch(() => sendResponse({ status: "FAILED" }));
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
    if (!isLightTheme(object.lightTheme) || !isDarkTheme(object.darkTheme)) { sendResponse({ ok: false, error: "BAD_REQUEST" }); return false; }
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? (changeInfo.status === 'complete' ? tab.url : undefined);
  if (url) void completeDashboardLogin(tabId, url).catch(() => undefined);
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
