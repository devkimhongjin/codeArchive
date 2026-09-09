import { AuthLoginStageError } from "./authDiagnostics";
import { AUTH_LOGIN, type AuthLoginResponse } from "./authMessages";
import type { CodeArchiveAuthService } from "./authSession";
import { backgroundCodeArchiveAuthService } from "./backgroundAuthRuntime";
import { backgroundDashboardCaptureBridge, notifyCaptureCommitted, notifyDashboardCaptureChanged, registerExternalDashboardBridge, type ExternalDashboardPort } from "./dashboardCaptureBridge";
import { CODEARCHIVE_DASHBOARD_ORIGIN } from "./dashboardConfig";
import { SAVE_SWEA_ACCEPTED, UPDATE_SWEA_CAPTURE_PERFORMANCE, type SaveResponse } from "./sweaAutoCapture";
import { enrichAcceptedCapturePerformance, saveAcceptedCapture } from "./solutionRepository";
import { isAutoCapturePlatform, SAVE_ACCEPTED_CAPTURE, type AcceptedCapture } from "./acceptedCapture";
import type { SubmissionPerformance } from "./solution";
import { syncSolutionRecord, type SolutionSyncDependencies } from "./solutionSync";
import { createProblemContestIdHandoffStore, SWEA_CONSUME_PROBLEM_CONTEST_ID, SWEA_STORE_PROBLEM_CONTEST_ID } from "./sweaProblemIdentityHandoff";
import { SWEA_PROBLEM_DETAIL_PATH, SWEA_SOLVING_PATH } from "./adapters/swea/sweaSelectors";
import { POPUP_AUTOMATION_SET, POPUP_AUTOMATION_STATE_GET } from "./automationControl";
import { POPUP_RELAY_LOCAL_STOP, POPUP_RELAY_STATE_GET } from "./relay/relayPopupControl";
import { backgroundRelayRuntime } from "./relay/relayRuntime";

type BackgroundResponse = SaveResponse | AuthLoginResponse;

declare const chrome: {
  runtime: {
    onMessage: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void };
    onConnectExternal: { addListener(listener: (port: ExternalDashboardPort) => void): void };
  };
};

export function valid(value: unknown): value is AcceptedCapture {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return isAutoCapturePlatform(c.platform) && c.result === "ACCEPTED" && ["captureId", "problemNumber", "title", "language", "code", "observedAt", "solvedAt"].every((k) => typeof c[k] === "string" && (c[k] as string).trim()) && (c.problemUrl === undefined || typeof c.problemUrl === "string");
}

export function validPerformanceUpdate(value: unknown): value is { solutionId: string; expectedSavedAt: string; performance: SubmissionPerformance } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const performance = candidate.performance;
  if (!performance || typeof performance !== "object") return false;
  const metrics = performance as Record<string, unknown>;
  return typeof candidate.solutionId === "string"
    && /^swea-auto:.+/.test(candidate.solutionId)
    && typeof candidate.expectedSavedAt === "string"
    && Number.isFinite(Date.parse(candidate.expectedSavedAt))
    && typeof metrics.executionTime === "string"
    && /^(0|[1-9]\d*) ms$/.test(metrics.executionTime)
    && typeof metrics.memoryUsage === "string"
    && /^(0|[1-9]\d{0,2}(?:,\d{3})*) kb$/.test(metrics.memoryUsage);
}

interface CaptureSyncDependencies {
  saveCapture(capture: AcceptedCapture): Promise<SaveResponse>;
  /** Legacy direct-sync injection retained only as rollback/reference until cleanup #86. */
  sync?: SolutionSyncDependencies;
  onCaptureCommitted?: () => Promise<void>;
}

export async function saveThenSyncAcceptedCapture(capture: AcceptedCapture, dependencies: CaptureSyncDependencies): Promise<SaveResponse> {
  const localResult = await dependencies.saveCapture(capture);
  if (localResult.status === "saved") {
    void dependencies.onCaptureCommitted?.().catch(() => undefined);
  }
  if (dependencies.sync && (localResult.status === "saved" || localResult.status === "duplicate")) {
    void syncSolutionRecord(localResult.solutionId, dependencies.sync).catch(() => undefined);
  }
  return localResult;
}

export async function notifyAndScheduleSweaRelay(
  notify: () => Promise<void> = notifyDashboardCaptureChanged,
  relay: () => Promise<void> = () => backgroundRelayRuntime.onCaptureCommitted(),
): Promise<void> {
  const relayPromise = relay().catch(() => undefined);
  await notify().catch(() => undefined);
  await relayPromise;
}

export async function runBackgroundLogin(authService: Pick<CodeArchiveAuthService, "login">): Promise<AuthLoginResponse> {
  try {
    return { ok: true, state: await authService.login() };
  } catch (error) {
    return { ok: false, error: error instanceof AuthLoginStageError ? error.stage : "auth_failed" };
  }
}

const defaultDependencies: CaptureSyncDependencies = {
  saveCapture: saveAcceptedCapture,
  onCaptureCommitted: notifyCaptureCommitted,
};

const sweaDependencies: CaptureSyncDependencies = {
  saveCapture: saveAcceptedCapture,
  onCaptureCommitted: notifyAndScheduleSweaRelay,
};

registerExternalDashboardBridge(chrome.runtime, CODEARCHIVE_DASHBOARD_ORIGIN);

const problemContestIdHandoffs = createProblemContestIdHandoffStore();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const request = message as { type?: string; capture?: unknown };
  const senderTab = (sender as { tab?: { id?: number; url?: string } } | undefined)?.tab;
  const tabId = senderTab?.id;
  let senderUrl: URL | null = null;
  try { if (senderTab?.url) senderUrl = new URL(senderTab.url); } catch { /* fail closed */ }

  if (request.type === SWEA_STORE_PROBLEM_CONTEST_ID) {
    const problemContestId = (message as { problemContestId?: unknown }).problemContestId;
    if (!Number.isInteger(tabId) || senderUrl?.origin !== "https://swexpertacademy.com" || senderUrl.pathname !== SWEA_PROBLEM_DETAIL_PATH || typeof problemContestId !== "string") {
      sendResponse({ ok: false });
      return;
    }
    problemContestIdHandoffs.issue(tabId!, problemContestId, senderUrl.href)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (request.type === SWEA_CONSUME_PROBLEM_CONTEST_ID) {
    const page = message as { origin?: unknown; path?: unknown; referrer?: unknown };
    if (!Number.isInteger(tabId) || senderUrl?.origin !== "https://swexpertacademy.com" || senderUrl.pathname !== SWEA_SOLVING_PATH || typeof page.origin !== "string" || typeof page.path !== "string" || typeof page.referrer !== "string") {
      sendResponse({ problemContestId: null });
      return;
    }
    problemContestIdHandoffs.consume(tabId!, page.origin, page.path, page.referrer)
      .then((problemContestId) => sendResponse({ problemContestId }))
      .catch(() => sendResponse({ problemContestId: null }));
    return true;
  }

  if (request.type === AUTH_LOGIN) {
    runBackgroundLogin(backgroundCodeArchiveAuthService).then(sendResponse);
    return true;
  }

  if (request.type === POPUP_AUTOMATION_STATE_GET) {
    backgroundDashboardCaptureBridge.requestAutomationState().then(sendResponse);
    return true;
  }

  if (request.type === POPUP_AUTOMATION_SET) {
    const automation = (message as { automation?: unknown }).automation;
    const enabled = (message as { enabled?: unknown }).enabled;
    if ((automation !== "AUTO_SYNC" && automation !== "GITHUB_AUTO_COMMIT") || typeof enabled !== "boolean") {
      sendResponse({ accepted: false, state: backgroundDashboardCaptureBridge.getAutomationState(), forwarded: false });
      return;
    }
    const forward = () => backgroundDashboardCaptureBridge.setAutomation(automation, enabled).then(sendResponse);
    if (automation === "AUTO_SYNC" && !enabled) {
      backgroundRelayRuntime.stopLocally().then(forward).catch(() => sendResponse({ accepted: false, state: backgroundDashboardCaptureBridge.getAutomationState(), forwarded: false }));
    } else {
      forward();
    }
    return true;
  }

  if (request.type === POPUP_RELAY_STATE_GET) {
    backgroundRelayRuntime.getPopupState().then(sendResponse).catch(() => sendResponse({ state: "UNPAIRED", autoSyncEnabled: false, readStatus: "error" }));
    return true;
  }

  if (request.type === POPUP_RELAY_LOCAL_STOP) {
    backgroundRelayRuntime.stopLocally().then(sendResponse).catch(() => sendResponse({ state: "UNPAIRED", autoSyncEnabled: false, readStatus: "error" }));
    return true;
  }

  if (request.type === UPDATE_SWEA_CAPTURE_PERFORMANCE) {
    const update = message as { solutionId?: unknown; expectedSavedAt?: unknown; performance?: unknown };
    if (!validPerformanceUpdate(update)) {
      sendResponse({ status: "skipped" });
      return;
    }
    enrichAcceptedCapturePerformance(update.solutionId, update.expectedSavedAt, update.performance)
      .then((status) => sendResponse({ status }))
      .catch(() => sendResponse({ status: "skipped" }));
    return true;
  }

  if ((request.type !== SAVE_SWEA_ACCEPTED && request.type !== SAVE_ACCEPTED_CAPTURE) || !valid(request.capture)) {
    sendResponse({ status: "rejected", reason: "invalid_capture" });
    return;
  }
  saveThenSyncAcceptedCapture(request.capture, request.type === SAVE_SWEA_ACCEPTED ? sweaDependencies : defaultDependencies)
    .then(sendResponse)
    .catch(() => sendResponse({ status: "failed", reason: "storage_failed" }));
  return true;
});
