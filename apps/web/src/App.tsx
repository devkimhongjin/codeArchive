import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveSessionExpiredError, mainApiArchiveDataSource } from "./archiveDataSource";
import {
  groupDashboardSolutions,
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
import { SolutionDetailActions } from "./SolutionDetailActions";

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
}: AppProps) {
  const [archive, setArchive] = useState<{ account: string; records: readonly DashboardSolution[] }>({ account: "", records: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [archiveRefreshAttempt, setArchiveRefreshAttempt] = useState(0);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [extensionState, setExtensionState] = useState<ExtensionConnectionState>({ status: "connecting" });
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [verifiedAuthClient, setVerifiedAuthClient] = useState<DashboardAuthClient | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  // The legacy persisted boolean has no account binding. Require fresh consent
  // for each authenticated session, retaining it only across bridge reconnects.
  const [autoSyncConsent, setAutoSyncConsent] = useState(false);
  const [activeSyncSessionId, setActiveSyncSessionId] = useState<string | null>(null);

  const drainEligibilityRef = useRef({ eligible: false, activeSyncSessionId: null as string | null });

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
      (syncSessionId) => drainEligibilityRef.current.eligible
        && drainEligibilityRef.current.activeSyncSessionId === syncSessionId,
      () => setArchiveRefreshAttempt((value) => value + 1),
    ),
    [extensionConnection, importBatchIdGenerator, pendingDrainApiClient],
  );

  useEffect(
    () => extensionConnection.start(
      setExtensionState,
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
    ),
    [extensionConnection, connectionAttempt],
  );

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setAutoSyncConsent(false);
    setAuthState({ status: "loading" });
    void authClient.discoverSession(abort.signal).then((result) => {
      if (!active) return;
      setVerifiedAuthClient(authClient);
      setAuthState(result);
    }).catch(() => {
      if (active) setAuthState({ status: "unavailable" });
    });
    return () => { active = false; abort.abort(); };
  }, [authClient, authAttempt]);

  const authenticated = authState.status === "authenticated" && verifiedAuthClient === authClient && !logoutPending;
  const account = authenticated ? authState.user.githubLogin : "";
  const accountRef = useRef(account);
  accountRef.current = account;
  const records = account && archive.account === account ? archive.records : [];
  const connected = extensionState.status === "connected";
  const exactOrigin = isExactDashboardOrigin(dashboardOrigin);
  const eligible = authenticated
    && autoSyncConsent
    && exactOrigin
    && connected
    && !logoutPending
    && !consentPending;

  drainEligibilityRef.current = { eligible, activeSyncSessionId };

  useEffect(() => {
    const authContextKey = authenticated ? authState.user.githubLogin : "";
    void syncController.setEligibility(eligible, authContextKey);
  }, [authState, authenticated, eligible, syncController]);

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
        setSelectedId(next[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (!active || accountRef.current !== account) return;
        if (cause instanceof ArchiveSessionExpiredError) {
          drainEligibilityRef.current.eligible = false;
          pendingDrainController.invalidate();
          void syncController.teardown();
          setAutoSyncConsent(false);
          setAuthState({ status: "signed_out" });
        } else setError("풀이 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; abort.abort(); };
  }, [account, archiveRefreshAttempt, dataSource, pendingDrainController, syncController]);

  async function setConsent(enabled: boolean) {
    if (enabled) {
      consentStore.write(true);
      setAutoSyncConsent(true);
      return;
    }

    setConsentPending(true);
    drainEligibilityRef.current.eligible = false;
    pendingDrainController.invalidate();
    await syncController.teardown();
    consentStore.write(false);
    setAutoSyncConsent(false);
    setConsentPending(false);
  }

  async function logout() {
    accountRef.current = "";
    drainEligibilityRef.current.eligible = false;
    setLogoutPending(true);
    setAutoSyncConsent(false);
    consentStore.write(false);
    setArchive({ account: "", records: [] });
    setSelectedId(null);
    pendingDrainController.invalidate();
    const ok = await authClient.logout(async () => {
      await syncController.teardown();
      await beforeLogout?.();
    });
    setLogoutPending(false);
    setAuthState(ok ? { status: "signed_out" } : { status: "unavailable" });
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((record) =>
      [record.platform, record.problemNumber, record.title, record.language]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, records]);

  const groups = useMemo(() => groupDashboardSolutions(filtered), [filtered]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0] ?? null;

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
                    <small>{autoSyncConsent ? "사용자 동의됨 · 연결 조건 충족 시 자동 전송" : "꺼짐 · 로그인만으로는 시작되지 않음"}</small>
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
        </div>
      </header>

      <section className="toolbar" aria-label="풀이 검색">
        <label>
          <span>검색</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="문제 번호, 제목, 언어" />
        </label>
        <strong>{filtered.length}건 · {groups.length}문제</strong>
      </section>

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
            {groups.length === 0 ? <p className="state-card">검색 결과가 없습니다.</p> : groups.map((group) => (
              <article className="problem-group" key={group.key}>
                <div className="problem-heading"><div><strong>{group.title}</strong><span>{group.platform} · {group.problemNumber}</span></div><small>{group.records.length}회</small></div>
                <div className="submission-list">{group.records.map((record) => (
                  <button type="button" key={record.id} className={record.id === selected?.id ? "submission selected" : "submission"} onClick={() => setSelectedId(record.id)}>
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
                <SolutionDetailActions solution={selected} />
                <pre className="code-view"><code>{selected.code}</code></pre>
                <p className="future-note">Main API에 보관된 풀이입니다. 서버 수정·삭제는 지원 계약이 추가될 때 별도 제공됩니다.</p>
              </article>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
