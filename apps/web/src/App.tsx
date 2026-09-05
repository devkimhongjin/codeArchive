import { useEffect, useMemo, useRef, useState } from "react";
import { CommunityPermalink, CommunitySharing } from "./Community";
import { GitHubUpload } from "./GitHubUpload";
import { mainApiGitHubClient, type GitHubClient } from "./githubClient";
import { invalidateCommunity } from "./communityLifecycle";
import { mainApiCommunityClient, type CommunityClient } from "./communityClient";
import { createAccountConsentController, validatedAccountId } from "./accountConsent";
import { ArchiveSessionExpiredError, mainApiArchiveDataSource } from "./archiveDataSource";
import { archiveFilterOptions, EMPTY_ARCHIVE_FILTERS, filterDashboardSolutions } from "./archiveFilters";
import {
  groupDashboardSolutions,
  type ArchiveSortOrder,
  type DashboardArchiveDataSource,
  type DashboardSolution,
} from "./archiveTypes";
import {
  createAutoSyncSessionController,
  dashboardAutoSyncConsentStore,
  isExactDashboardOrigin,
  secureSyncSessionId,
  type AutoSyncConsentStore,
} from "./autoSyncSession";
import {
  dashboardAuthClient,
  type DashboardAuthClient,
  type DashboardUser,
} from "./authClient";
import "./styles.css";
import {
  dashboardExtensionConnection,
  type DashboardExtensionConnection,
  type ExtensionConnectionState,
} from "./extensionConnection";
import {
  createPendingDrainController,
  dashboardPendingDrainApiClient,
  secureImportBatchId,
  type PendingDrainApiClient,
} from "./pendingDrain";
import { SolutionDetailActions } from "./DashboardSolutionDetailActions";
import { mainApiAiArtifactClient, type DashboardAiArtifactClient } from "./aiArtifactClient";
import { mainApiSolutionDeleteClient, type DashboardSolutionDeleteClient } from "./solutionDeleteClient";
import {
  mainApiSolutionUpdateClient,
  type DashboardSolutionUpdateClient,
} from "./solutionUpdateClient";
import {
  sanitizeAutomationState,
  type AutomationStateInput,
} from "./automationControl";
import { notifyExplicitAutoSyncOff } from "./durableAutomationIntent";
import type {
  CodeArchiveAutomationControlErrorCode,
  ExtensionToDashboardAutomationMessage,
} from "../../../packages/shared-types/src";

interface AppProps {
  dataSource?: DashboardArchiveDataSource;
  extensionConnection?: DashboardExtensionConnection;
  authClient?: DashboardAuthClient;
  beforeLogout?: () => Promise<void> | void;
  consentStore?: AutoSyncConsentStore;
  dashboardOrigin?: string;
  syncSessionIdGenerator?: () => string;
  pendingDrainApiClient?: PendingDrainApiClient;
  importBatchIdGenerator?: () => string;
  solutionUpdateClient?: DashboardSolutionUpdateClient;
  solutionDeleteClient?: DashboardSolutionDeleteClient;
  aiArtifactClient?: DashboardAiArtifactClient;
  communityClient?: CommunityClient;
  githubClient?: GitHubClient;
}

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "authenticated"; user: DashboardUser }
  | { status: "unavailable" };

function formatDate(value: string | null): string {
  return value ?? "미입력";
}

function sourceLabel(source: DashboardSolution["source"]): string {
  return source === "captured" ? "자동 수집" : "수동 기록";
}

export function App({
  dataSource = mainApiArchiveDataSource,
  extensionConnection = dashboardExtensionConnection,
  authClient = dashboardAuthClient,
  beforeLogout,
  consentStore = dashboardAutoSyncConsentStore,
  dashboardOrigin = globalThis.location.origin,
  syncSessionIdGenerator = secureSyncSessionId,
  pendingDrainApiClient = dashboardPendingDrainApiClient,
  importBatchIdGenerator = secureImportBatchId,
  solutionUpdateClient = mainApiSolutionUpdateClient,
  solutionDeleteClient = mainApiSolutionDeleteClient,
  aiArtifactClient = mainApiAiArtifactClient,
  communityClient = mainApiCommunityClient,
  githubClient = mainApiGitHubClient,
}: AppProps) {
  const [archive, setArchive] = useState<{ account: string; records: readonly DashboardSolution[] }>({ account: "", records: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_ARCHIVE_FILTERS);
  const [sortOrder, setSortOrder] = useState<ArchiveSortOrder>("updated_desc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteNotice, setDeleteNotice] = useState({ account: "", message: "" });
  const [archiveRefreshAttempt, setArchiveRefreshAttempt] = useState(0);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [extensionState, setExtensionState] = useState<ExtensionConnectionState>({ status: "connecting" });
  const extensionStateRef = useRef<ExtensionConnectionState>({ status: "connecting" });
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [verifiedAuthClient, setVerifiedAuthClient] = useState<DashboardAuthClient | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  // Restored only after /me verification and matching immutable account binding.
  const [autoSyncConsent, setAutoSyncConsent] = useState(false);
  const [activeSyncSessionId, setActiveSyncSessionId] = useState<string | null>(null);
  const [automationAutoSyncEnabled, setAutomationAutoSyncEnabled] = useState(false);
  const [githubAutoCommitEnabled, setGithubAutoCommitEnabled] = useState(false);
  const [githubTargetConfigured, setGithubTargetConfigured] = useState(false);
  const [automationError, setAutomationError] = useState<CodeArchiveAutomationControlErrorCode | null>(null);
  const [automationIntent, setAutomationIntent] = useState<{ enabled: boolean; nonce: number } | null>(null);
  const [automationSafetyStopped, setAutomationSafetyStopped] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [manualSyncStatus, setManualSyncStatus] = useState<"idle" | "running" | "success" | "partial" | "blocked" | "failed">("idle");
  const [manualSyncMessage, setManualSyncMessage] = useState("");

  const drainEligibilityRef = useRef({ eligible: false, activeSyncSessionId: null as string | null });
  const manualSyncSessionRef = useRef<{
    id: string;
    ownsSession: boolean;
    eligible: boolean;
    started: Promise<boolean>;
    cleanup?: Promise<void>;
  } | null>(null);
  const manualSyncPendingBeforeRef = useRef(0);
  const sessionExpiredRef = useRef(() => {});
  const automationSafetyStoppedRef = useRef(false);
  const automationStateRef = useRef(sanitizeAutomationState({
    autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: false,
    authenticated: false, connectionAvailable: false,
  }));
  const automationMessageRef = useRef<(message: ExtensionToDashboardAutomationMessage) => void>(() => {});
  const automationNonceRef = useRef(0);
  const previousAutomationAccountRef = useRef("");

  const syncController = useMemo(
    () => createAutoSyncSessionController(
      extensionConnection,
      syncSessionIdGenerator,
      setActiveSyncSessionId,
    ),
    [extensionConnection, syncSessionIdGenerator],
  );

  const pendingDrainController = useMemo(
    () => createPendingDrainController(
      extensionConnection,
      pendingDrainApiClient,
      importBatchIdGenerator,
      (syncSessionId) => (
        (drainEligibilityRef.current.eligible
          && drainEligibilityRef.current.activeSyncSessionId === syncSessionId)
        || (manualSyncSessionRef.current?.id === syncSessionId
          && manualSyncSessionRef.current.eligible)
      ),
      () => setArchiveRefreshAttempt((value) => value + 1),
      () => sessionExpiredRef.current(),
    ),
    [extensionConnection, importBatchIdGenerator, pendingDrainApiClient],
  );

  const consentController = useMemo(() => createAccountConsentController(consentStore, (enabled) => {
    if (!enabled) {
      drainEligibilityRef.current.eligible = false;
      pendingDrainController.invalidate();
      manualSyncSessionRef.current && (manualSyncSessionRef.current.eligible = false);
      void syncController.teardown();
      setGithubAutoCommitEnabled(false);
      automationNonceRef.current += 1;
      setAutomationIntent({ enabled: false, nonce: automationNonceRef.current });
    }
    setAutoSyncConsent(enabled);
    setAutomationAutoSyncEnabled(enabled && !automationSafetyStoppedRef.current);
    if (enabled) setAutomationError(null);
  }, undefined, () => {
    setAuthState({ status: "loading" });
    setAuthAttempt((value) => value + 1);
  }), [consentStore, pendingDrainController, syncController]);

  function expireSession() {
    consentController.reset(true);
    setGithubTargetConfigured(false);
    setGithubAutoCommitEnabled(false);
    nextAutomationIntent(false);
    setDeleteNotice({ account: "", message: "" });
    setSelectedId(null);
    setAuthState({ status: "signed_out" });
  }
  sessionExpiredRef.current = expireSession;

  useEffect(() => consentController.subscribe(), [consentController]);

  useEffect(
    () => extensionConnection.start(
      (state) => {
        const wasConnected = extensionStateRef.current.status === "connected";
        extensionStateRef.current = state;
        setExtensionState(state);
        if (wasConnected && state.status !== "connected") void notifyExplicitAutoSyncOff();
      },
      (event) => {
        setExtensionState((current) => current.status === "connected"
          ? {
              status: "connected",
              summary: {
                ...current.summary,
                pendingCount: event.pendingCount,
                revision: event.revision,
              },
            }
          : current);
      },
      (message) => automationMessageRef.current(message),
    ),
    [extensionConnection, connectionAttempt],
  );

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    consentController.reset(false);
    setDeleteNotice({ account: "", message: "" });
    setAuthState({ status: "loading" });
    void authClient.discoverSession(abort.signal).then((result) => {
      if (!active) return;
      setVerifiedAuthClient(authClient);
      setAuthState(result);
      if (result.status === "authenticated") void consentController.verify(result.user.id);
      else consentController.reset(result.status === "signed_out");
    }).catch(() => {
      if (active) setAuthState({ status: "unavailable" });
    });
    return () => { active = false; abort.abort(); };
  }, [authClient, authAttempt, consentController]);

  const authenticated = authState.status === "authenticated" && verifiedAuthClient === authClient && !logoutPending;
  const immutableAccountId = authenticated ? validatedAccountId(authState.user.id) : undefined;
  const account = immutableAccountId ?? "";
  const accountRef = useRef(account);
  accountRef.current = account;
  const records = account && archive.account === account ? archive.records : [];

  useEffect(() => {
    setFilters(EMPTY_ARCHIVE_FILTERS);
    setSortOrder("updated_desc");
  }, [account]);
  const connected = extensionState.status === "connected";
  const exactOrigin = isExactDashboardOrigin(dashboardOrigin);
  const baseAutomationError = !authenticated ? "AUTH_REQUIRED" : !exactOrigin ? "CONTROL_UNAVAILABLE" : !connected ? "DASHBOARD_DISCONNECTED" : !online ? "OFFLINE" : null as CodeArchiveAutomationControlErrorCode | null;
  const currentAutomationError = automationSafetyStopped
    ? "MULTIPLE_DASHBOARD_TABS"
    : baseAutomationError ?? automationError;
  const effectiveAutoSyncEnabled = automationAutoSyncEnabled && autoSyncConsent && authenticated && exactOrigin && connected && online && !logoutPending && !consentPending && !automationSafetyStoppedRef.current;
  const effectiveGitHubAutoCommitEnabled = githubAutoCommitEnabled && effectiveAutoSyncEnabled && githubTargetConfigured;
  const eligible = authenticated
    && effectiveAutoSyncEnabled
    && exactOrigin
    && connected
    && !logoutPending
    && !consentPending;
  const githubAutomationBlockedReason = !authenticated
    ? "GitHub 자동 커밋은 먼저 Dashboard에 로그인해야 사용할 수 있습니다."
    : !immutableAccountId
      ? "CodeArchive 계정 식별자를 확인할 수 없어 GitHub 자동 커밋을 시작할 수 없습니다. Dashboard를 새로고침하거나 다시 로그인해 주세요."
      : !exactOrigin
        ? "승인된 Dashboard 주소에서만 GitHub 자동 커밋을 사용할 수 있습니다."
        : !connected
          ? "Extension 연결을 확인해야 GitHub 자동 커밋을 켤 수 있습니다."
          : !online
            ? "온라인 상태가 되어야 GitHub 자동 커밋을 켤 수 있습니다."
            : !autoSyncConsent
              ? "자동 동기화 동의를 먼저 켜야 GitHub 자동 커밋을 사용할 수 있습니다."
              : consentPending
                ? "계정 동의를 확인하는 중입니다. 확인이 끝나면 다시 시도하세요."
                : automationSafetyStopped
                  ? "Dashboard가 여러 탭에서 열려 자동 커밋을 안전하게 시작할 수 없습니다. 다른 탭을 닫고 다시 시도하세요."
                  : !automationAutoSyncEnabled
                    ? "자동 동기화가 OFF 상태입니다. 자동 동기화를 먼저 켠 뒤 GitHub 자동 커밋을 활성화하세요."
                    : null;

  drainEligibilityRef.current = { eligible, activeSyncSessionId };
  if (manualSyncSessionRef.current) {
    manualSyncSessionRef.current.eligible = authenticated
      && autoSyncConsent
      && exactOrigin
      && connected
      && online
      && !logoutPending
      && !consentPending
      && !automationSafetyStopped;
  }

  automationStateRef.current = sanitizeAutomationState({
    autoSyncEnabled: effectiveAutoSyncEnabled,
    githubAutoCommitEnabled: effectiveGitHubAutoCommitEnabled,
    githubTargetConfigured,
    authenticated,
    connectionAvailable: connected,
    errorCode: currentAutomationError,
  } satisfies AutomationStateInput);

  function nextAutomationIntent(enabled: boolean) {
    automationNonceRef.current += 1;
    setAutomationIntent({ enabled, nonce: automationNonceRef.current });
  }

  function invalidateAutomation(clearConsent: boolean) {
    setAutomationAutoSyncEnabled(false);
    setGithubAutoCommitEnabled(false);
    nextAutomationIntent(false);
    drainEligibilityRef.current.eligible = false;
    if (manualSyncSessionRef.current) manualSyncSessionRef.current.eligible = false;
    pendingDrainController.invalidate();
    void syncController.teardown();
    if (clearConsent) consentController.reset(true);
  }

  function automationGuard(kind: "AUTO_SYNC" | "GITHUB_AUTO_COMMIT"): CodeArchiveAutomationControlErrorCode | null {
    if (!authenticated) return "AUTH_REQUIRED";
    if (!exactOrigin) return "CONTROL_UNAVAILABLE";
    if (!connected) return "DASHBOARD_DISCONNECTED";
    if (!online) return "OFFLINE";
    if (kind === "GITHUB_AUTO_COMMIT") {
      if (!effectiveAutoSyncEnabled) return "AUTO_SYNC_CONSENT_REQUIRED";
      if (!githubTargetConfigured) return "GITHUB_TARGET_REQUIRED";
    }
    if (!autoSyncConsent) return "AUTO_SYNC_CONSENT_REQUIRED";
    return null;
  }

  async function cleanupManualSyncSession(context: NonNullable<typeof manualSyncSessionRef.current>) {
    if (context.cleanup) return context.cleanup;
    context.cleanup = (async () => {
      const started = await context.started;
      if (context.ownsSession && started) {
        try { await extensionConnection.endSyncSession(context.id); } catch { /* Cleanup is best effort after invalidation. */ }
      }
      if (manualSyncSessionRef.current === context) manualSyncSessionRef.current = null;
    })();
    return context.cleanup;
  }

  function invalidateManualSync(): Promise<void> | undefined {
    const context = manualSyncSessionRef.current;
    if (!context) return undefined;
    context.eligible = false;
    pendingDrainController.invalidate();
    return cleanupManualSyncSession(context);
  }

  function manualSyncBlockReason(): string | null {
    if (!authenticated) return "로그인 후 로컬 풀이를 동기화할 수 있습니다.";
    if (!exactOrigin) return "승인된 Dashboard에서만 로컬 풀이를 동기화할 수 있습니다.";
    if (!online) return "오프라인 상태에서는 동기화할 수 없습니다.";
    if (automationSafetyStopped) return "여러 Dashboard 탭이 감지되어 동기화를 중지했습니다.";
    if (!connected) return "Extension 연결 후 동기화할 수 있습니다.";
    if (!autoSyncConsent) return "자동 동기화 동의 후 로컬 풀이 동기화됩니다.";
    if (logoutPending || consentPending) return "현재 계정 상태가 정리되는 중입니다.";
    if (pendingDrainController.isBusy()) return "이미 동기화 중입니다.";
    return null;
  }

  async function runManualSync() {
    if (manualSyncStatus === "running") return;
    const blocked = manualSyncBlockReason();
    if (blocked) {
      setManualSyncStatus("blocked");
      setManualSyncMessage(blocked);
      return;
    }
    if (pendingDrainController.isBusy()) {
      setManualSyncStatus("blocked");
      setManualSyncMessage("이미 동기화 중입니다.");
      return;
    }
    // An automatic session is reusable only while automatic mode is still effective.
    // During AUTO_SYNC teardown, activeSyncSessionId can briefly remain populated;
    // treating it as eligible there would race a manual session against that teardown.
    const existingSessionId = effectiveAutoSyncEnabled ? activeSyncSessionId : null;
    const context = {
      id: existingSessionId ?? syncSessionIdGenerator(),
      ownsSession: existingSessionId === null,
      eligible: true,
      started: Promise.resolve(existingSessionId !== null),
    };
    manualSyncSessionRef.current = context;
    manualSyncPendingBeforeRef.current = extensionState.status === "connected" ? extensionState.summary.pendingCount : 0;
    setManualSyncStatus("running");
    setManualSyncMessage("동기화 중");
    context.started = context.ownsSession
      ? extensionConnection.startSyncSession(context.id).catch(() => false)
      : Promise.resolve(true);
    try {
      const started = await context.started;
      if (!started || !context.eligible) {
        setManualSyncStatus("blocked");
        setManualSyncMessage("현재 연결 또는 계정 상태가 바뀌어 동기화를 취소했습니다.");
        return;
      }
      const result = await pendingDrainController.run(context.id);
      if (result.status === "busy") {
        setManualSyncStatus("blocked");
        setManualSyncMessage("이미 동기화 중입니다.");
        return;
      }
      if (result.acknowledged > 0) {
        setExtensionState((current) => current.status === "connected"
          ? { ...current, summary: { ...current.summary, pendingCount: Math.max(0, current.summary.pendingCount - result.acknowledged) } }
          : current);
      }
      if (result.status === "completed" && result.recordsRead === 0) {
        setManualSyncStatus("success");
        setManualSyncMessage("동기화할 로컬 풀이 없음");
        return;
      }
      if (result.status === "completed" && result.acknowledged === result.recordsRead) {
        setManualSyncStatus("success");
        setManualSyncMessage(`${result.acknowledged}건 동기화 완료`);
        return;
      }
      if (result.acknowledged > 0) {
        const remaining = Math.max(0, manualSyncPendingBeforeRef.current - result.acknowledged);
        setManualSyncStatus("partial");
        setManualSyncMessage(`${result.acknowledged}건 동기화 완료 · ${remaining}건 pending 남음`);
        return;
      }
      setManualSyncStatus(result.status === "cancelled" || result.status === "unavailable" ? "blocked" : "failed");
      setManualSyncMessage(result.status === "cancelled"
        ? "현재 연결 또는 계정 상태가 바뀌어 동기화를 취소했습니다."
        : result.status === "unavailable"
          ? "현재 Extension 연결에서 동기화를 시작할 수 없습니다."
          : "동기화에 실패했습니다. pending 풀이는 로컬에 유지됩니다.");
    } finally {
      await cleanupManualSyncSession(context);
    }
  }

  automationMessageRef.current = (message) => {
    if (message.type === "CODEARCHIVE_AUTOMATION_STATE_REQUEST") {
      extensionConnection.publishAutomationState?.(automationStateRef.current);
      return;
    }
    if (message.type === "CODEARCHIVE_AUTOMATION_SAFETY_STOP") {
      automationSafetyStoppedRef.current = true;
      setAutomationSafetyStopped(true);
      setAutomationError("MULTIPLE_DASHBOARD_TABS");
      invalidateManualSync();
      invalidateAutomation(false);
      return;
    }
    if (message.automation === "AUTO_SYNC") {
      if (!message.enabled) {
        setAutomationError(null);
        setAutomationAutoSyncEnabled(false);
        setGithubAutoCommitEnabled(false);
        nextAutomationIntent(false);
        drainEligibilityRef.current.eligible = false;
        pendingDrainController.invalidate();
        void syncController.teardown();
        return;
      }
      const errorCode = automationGuard("AUTO_SYNC");
      if (errorCode) { setAutomationAutoSyncEnabled(false); setAutomationError(errorCode); return; }
      automationSafetyStoppedRef.current = false;
      setAutomationSafetyStopped(false);
      setAutomationError(null);
      setAutomationAutoSyncEnabled(true);
      return;
    }
    if (!message.enabled) {
      setGithubAutoCommitEnabled(false);
      setAutomationError(null);
      nextAutomationIntent(false);
      return;
    }
    const errorCode = automationGuard("GITHUB_AUTO_COMMIT");
    if (errorCode) { setGithubAutoCommitEnabled(false); setAutomationError(errorCode); return; }
    setAutomationError(null);
    nextAutomationIntent(true);
  };

  useEffect(() => {
    extensionConnection.publishAutomationState?.(automationStateRef.current);
  }, [extensionConnection, effectiveAutoSyncEnabled, effectiveGitHubAutoCommitEnabled, githubTargetConfigured, authenticated, connected, online, currentAutomationError]);

  useEffect(() => {
    const becameOffline = () => setOnline(false);
    const becameOnline = () => setOnline(true);
    window.addEventListener("offline", becameOffline);
    window.addEventListener("online", becameOnline);
    const pagehide = () => { invalidateManualSync(); invalidateAutomation(false); };
    window.addEventListener("pagehide", pagehide);
    return () => {
      window.removeEventListener("offline", becameOffline);
      window.removeEventListener("online", becameOnline);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [consentController, pendingDrainController, syncController]);

  useEffect(() => {
    const previous = previousAutomationAccountRef.current;
    previousAutomationAccountRef.current = account;
    if (!previous || previous === account) return;
    invalidateManualSync();
    pendingDrainController.invalidate();
    setAutomationSafetyStopped(false);
    automationSafetyStoppedRef.current = false;
    setGithubAutoCommitEnabled(false);
    setGithubTargetConfigured(false);
    setManualSyncStatus("idle");
    setManualSyncMessage("");
    nextAutomationIntent(false);
    setAutomationAutoSyncEnabled(false);
  }, [account, pendingDrainController]);

  useEffect(() => {
    if (!effectiveAutoSyncEnabled || !githubTargetConfigured) {
      if (githubAutoCommitEnabled) setGithubAutoCommitEnabled(false);
      if (automationIntent?.enabled) nextAutomationIntent(false);
    }
  }, [effectiveAutoSyncEnabled, githubTargetConfigured, githubAutoCommitEnabled, automationIntent?.enabled]);

  useEffect(() => {
    const authContextKey = account;
    void syncController.setEligibility(eligible, authContextKey);
  }, [account, eligible, syncController]);

  useEffect(() => {
    if (!eligible || !activeSyncSessionId) {
      pendingDrainController.invalidate();
      return;
    }
    if (extensionState.status === "connected" && extensionState.summary.pendingCount > 0) {
      pendingDrainController.schedule(activeSyncSessionId);
    }
  }, [activeSyncSessionId, eligible, extensionState, pendingDrainController]);

  useEffect(() => () => {
    pendingDrainController.invalidate();
    void syncController.teardown();
  }, [pendingDrainController, syncController]);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setArchive({ account: "", records: [] });
    setSelectedId(null);
    setError("");
    if (!account) {
      setLoading(false);
      return;
    }
    setLoading(true);
    dataSource
      .listSolutions(abort.signal)
      .then((next) => {
        if (!active || accountRef.current !== account) return;
        setArchive({ account, records: next });
        // Until the user selects a row, detail follows the visible group order.
        setSelectedId(null);
      })
      .catch((cause: unknown) => {
        if (!active || accountRef.current !== account) return;
        if (cause instanceof ArchiveSessionExpiredError) {
          sessionExpiredRef.current();
        } else setError("풀이 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; abort.abort(); };
  }, [account, archiveRefreshAttempt, dataSource, pendingDrainController, syncController]);

  async function setConsent(enabled: boolean) {
    if (enabled) {
      if (authenticated) await consentController.choose(true);
      return;
    }

    setConsentPending(true);
    invalidateManualSync();
    await consentController.choose(false);
    await syncController.teardown();
    setConsentPending(false);
  }

  async function logout() {
    accountRef.current = "";
    const manualCleanup = invalidateManualSync();
    drainEligibilityRef.current.eligible = false;
    setLogoutPending(true);
    setDeleteNotice({ account: "", message: "" });
    consentController.reset(true);
    setGithubTargetConfigured(false);
    setGithubAutoCommitEnabled(false);
    nextAutomationIntent(false);
    setArchive({ account: "", records: [] });
    setSelectedId(null);
    pendingDrainController.invalidate();
    const ok = await authClient.logout(async () => {
      await manualCleanup;
      await syncController.teardown();
      await beforeLogout?.();
    });
    setLogoutPending(false);
    setAuthState(ok ? { status: "signed_out" } : { status: "unavailable" });
  }

  const filtered = useMemo(() => filterDashboardSolutions(records, filters), [filters, records]);
  const filterOptions = useMemo(() => archiveFilterOptions(records), [records]);
  const groups = useMemo(() => groupDashboardSolutions(filtered, sortOrder), [filtered, sortOrder]);
  const selected = filtered.find((record) => record.id === selectedId) ?? groups[0]?.records[0] ?? null;
  const hasFilters = Boolean(filters.query || filters.platform || filters.language);

  function resetArchiveFilters() {
    setFilters(EMPTY_ARCHIVE_FILTERS);
    setSortOrder("updated_desc");
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CodeArchive</p>
          <h1>전체 풀이</h1>
          <p className="subtitle">가볍게 탐색하는 풀이 아카이브</p>
        </div>
        <div className="header-statuses">
          <div className="auth-status" aria-live="polite">
            {authState.status === "loading" && <span>로그인 상태 확인 중</span>}
            {authState.status === "signed_out" && (
              <button className="primary-button" type="button" onClick={() => authClient.login()}>GitHub로 로그인</button>
            )}
            {authState.status === "authenticated" && (
              <>
                <div className="account-summary">
                  {authState.user.avatarUrl && <img src={authState.user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
                  <div>
                    <strong>{authState.user.displayName || authState.user.githubLogin}</strong>
                    <small>@{authState.user.githubLogin}</small>
                  </div>
                  <button type="button" disabled={logoutPending} onClick={() => void logout()}>{logoutPending ? "로그아웃 중" : "로그아웃"}</button>
                </div>
                <label className="auto-sync-consent">
                  <input
                    type="checkbox"
                    checked={autoSyncConsent}
                    disabled={logoutPending || consentPending}
                    onChange={(event) => void setConsent(event.target.checked)}
                  />
                  <span>
                    <strong>자동 동기화</strong>
                    <small>{autoSyncConsent ? "사용자 동의됨 · 연결 조건 충족 시 자동 전송" : "꺼짐 · 직접 켜야 시작됨"}</small>
                    <small>이 브라우저에서 같은 계정으로 다시 접속하면 동의를 기억합니다. 로그아웃·계정 변경·끄기 시 해제됩니다.</small>
                  </span>
                </label>
              </>
            )}
            {authState.status === "unavailable" && (
              <div className="retry-status">
                <span>로그인 상태를 확인할 수 없습니다.</span>
                <button type="button" onClick={() => setAuthAttempt((value) => value + 1)}>다시 시도</button>
              </div>
            )}
          </div>
          <div className="connection-status" aria-live="polite">
            <span className={`connection-dot ${extensionState.status}`} aria-hidden="true" />
            <div>
              <strong>
                {extensionState.status === "connected" ? "Extension 연결됨" :
                  extensionState.status === "connecting" ? "Extension 연결 확인 중" :
                    extensionState.status === "unavailable" ? "Extension을 찾을 수 없음" : "Extension 연결 오류"}
              </strong>
              <small>
                {extensionState.status === "connected"
                  ? `동기화 대기 ${extensionState.summary.pendingCount}건 · 로컬 전체 ${extensionState.summary.allCount}건`
                  : "로그인과 자동 동기화 동의 전에는 코드가 전송되지 않습니다."}
              </small>
            </div>
            {(extensionState.status === "unavailable" || extensionState.status === "error") && (
              <button type="button" onClick={() => setConnectionAttempt((value) => value + 1)}>다시 확인</button>
            )}
          </div>
          <div className="manual-sync-status" aria-live="polite">
            <strong>{extensionState.status === "connected" ? `로컬 pending ${extensionState.summary.pendingCount}건` : "로컬 pending 확인 불가"}</strong>
            <button type="button" disabled={manualSyncStatus === "running" || Boolean(manualSyncBlockReason())} onClick={() => void runManualSync()}>
              {manualSyncStatus === "running" ? "동기화 중" : "지금 동기화"}
            </button>
            <small>{manualSyncBlockReason() || manualSyncMessage || "현재 pending 풀이를 즉시 서버에 동기화합니다."}</small>
          </div>
        </div>
      </header>

      {authenticated && authState.status === "authenticated" && <GitHubUpload key={`${authState.user.id ?? "missing"}:${authState.user.githubLogin}`} accountIdValid={Boolean(immutableAccountId)} automationBlockedReason={githubAutomationBlockedReason} solution={selected ?? null} client={githubClient} syncEligible={eligible} automationIntent={automationIntent}
        onAutomationStateChange={(enabled, errorCode) => { setGithubAutoCommitEnabled(enabled); setAutomationError(errorCode); }}
        onTargetConfiguredChange={setGithubTargetConfigured}
        onSessionExpired={() => { if (accountRef.current === account) expireSession(); }} />}

      <section className="toolbar" aria-label="풀이 검색">
        <div className="archive-filters">
          <label className="archive-search">
            <span>검색</span>
            <input type="search" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="문제 번호, 제목, 언어" aria-describedby="archive-filter-scope" />
          </label>
          <label>
            <span>플랫폼</span>
            <select value={filters.platform} onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}>
              <option value="">모든 플랫폼</option>
              {filterOptions.platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
              {filters.platform && !filterOptions.platforms.includes(filters.platform) && <option value={filters.platform}>{filters.platform} (현재 기록 없음)</option>}
            </select>
          </label>
          <label>
            <span>언어</span>
            <select value={filters.language} onChange={(event) => setFilters((current) => ({ ...current, language: event.target.value }))}>
              <option value="">모든 언어</option>
              {filterOptions.languages.map((language) => <option key={language} value={language}>{language}</option>)}
              {filters.language && !filterOptions.languages.includes(filters.language) && <option value={filters.language}>{filters.language} (현재 기록 없음)</option>}
            </select>
          </label>
          <label>
            <span>정렬</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as ArchiveSortOrder)}>
              <option value="updated_desc">최근 수정순</option>
              <option value="updated_asc">오래된 수정순</option>
              <option value="problem_number">플랫폼·문제 번호순</option>
            </select>
          </label>
        </div>
        <div className="archive-filter-summary">
          <strong aria-live="polite" aria-atomic="true">{filtered.length}건 · {groups.length}문제</strong>
          <button type="button" disabled={!hasFilters && sortOrder === "updated_desc"} onClick={resetArchiveFilters}>검색·필터 초기화</button>
          {account && <button type="button" disabled={loading} onClick={() => setArchiveRefreshAttempt((value) => value + 1)}>목록 새로고침</button>}
        </div>
        <p id="archive-filter-scope" className="archive-filter-scope">현재 불러온 서버 기록 최대 50건 안에서 검색·필터·정렬합니다. 전체 기록 검색이나 통계가 아닙니다.</p>
      </section>

      <CommunityPermalink account={account} client={communityClient} onSessionExpired={() => { if (accountRef.current === account) expireSession(); }} />
      {account && deleteNotice.account === account && deleteNotice.message && (
        <p className="tool-feedback" role="status">{deleteNotice.message}</p>
      )}
      {!account ? (
        <p className="state-card">로그인 후 서버에 보관된 풀이를 확인할 수 있습니다.</p>
      ) : loading ? (
        <p className="state-card" role="status">풀이 목록을 불러오는 중입니다.</p>
      ) : error ? (
        <div className="state-card error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setArchiveRefreshAttempt((value) => value + 1)}>다시 불러오기</button>
        </div>
      ) : records.length === 0 ? (
        <p className="state-card">아직 표시할 풀이가 없습니다.</p>
      ) : (
        <div className="archive-layout">
          <section className="archive-list" aria-label="전체 풀이 목록">
            {groups.length === 0 ? <p className="state-card">검색 결과가 없습니다. 검색·필터 초기화로 다시 확인하세요.</p> : groups.map((group) => (
              <article className="problem-group" key={group.key}>
                <div className="problem-heading"><div><strong>{group.title}</strong><span>{group.platform} · {group.problemNumber}</span></div><small>{group.records.length}회</small></div>
                <div className="submission-list">{group.records.map((record) => (
                  <button type="button" key={record.id} aria-pressed={record.id === selected?.id} className={record.id === selected?.id ? "submission selected" : "submission"} onClick={() => setSelectedId(record.id)}>
                    <span>{sourceLabel(record.source)} · {record.language}</span><small>{formatDate(record.solvedAt)}</small>
                  </button>
                ))}</div>
              </article>
            ))}
          </section>

          <section className="detail-panel" aria-label="풀이 상세">
            {!selected ? <p className="state-card">목록에서 풀이를 선택하세요.</p> : (
              <article className="detail-card">
                <div className="detail-heading"><div><p className="eyebrow">{selected.platform} · {selected.problemNumber}</p><h2>{selected.title}</h2></div><span className="badge">{sourceLabel(selected.source)}</span></div>
                <dl className="metadata"><div><dt>언어</dt><dd>{selected.language}</dd></div><div><dt>풀이 날짜</dt><dd>{formatDate(selected.solvedAt)}</dd></div><div><dt>실행시간</dt><dd>{selected.executionTime ?? "미입력"}</dd></div><div><dt>메모리</dt><dd>{selected.memoryUsage ?? "미입력"}</dd></div></dl>
                <SolutionDetailActions
                  key={`${account}:${selected.id}`}
                  solution={selected}
                  updateClient={solutionUpdateClient}
                  deleteClient={solutionDeleteClient}
                  aiClient={aiArtifactClient}
                  onSolutionDeleted={(id) => {
                    if (accountRef.current !== account) return;
                    invalidateCommunity();
                    setArchive((current) => current.account === account
                      ? { account, records: current.records.filter((record) => record.id !== id) }
                      : current);
                    setSelectedId((current) => current === id ? null : current);
                    setDeleteNotice({ account, message: "서버 풀이를 삭제했습니다. Extension의 로컬 원본은 유지됩니다." });
                    setArchiveRefreshAttempt((value) => value + 1);
                  }}
                  onSolutionUpdated={(updated) => {
                    if (accountRef.current !== account) return;
                    invalidateCommunity();
                    setArchive((current) => current.account === account
                      ? {
                          account: current.account,
                          records: current.records.map((record) => record.id === updated.id ? updated : record),
                        }
                      : current);
                    setSelectedId(updated.id);
                  }}
                  onSessionExpired={() => { if (accountRef.current === account) expireSession(); }}
                />
                <pre className="code-view"><code>{selected.code}</code></pre>
                <CommunitySharing key={`${account}:${selected.id}:${selected.updatedAt}`} solution={selected} account={account} client={communityClient}
                  onSessionExpired={() => { if (accountRef.current === account) expireSession(); }} />
                <p className="future-note">Main API에 보관된 풀이입니다. 서버에서 수정·삭제해도 Extension의 로컬 원본은 유지됩니다.</p>
              </article>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
