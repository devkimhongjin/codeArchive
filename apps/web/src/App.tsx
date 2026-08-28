import { useEffect, useMemo, useState } from "react";
import { bootstrapArchiveDataSource } from "./archiveDataSource";
import {
  groupDashboardSolutions,
  type DashboardArchiveDataSource,
  type DashboardSolution,
} from "./archiveTypes";
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

interface AppProps {
  dataSource?: DashboardArchiveDataSource;
  extensionConnection?: DashboardExtensionConnection;
  authClient?: DashboardAuthClient;
  beforeLogout?: () => Promise<void> | void;
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
  dataSource = bootstrapArchiveDataSource,
  extensionConnection = dashboardExtensionConnection,
  authClient = dashboardAuthClient,
  beforeLogout,
}: AppProps) {
  const [records, setRecords] = useState<readonly DashboardSolution[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [extensionState, setExtensionState] = useState<ExtensionConnectionState>({ status: "connecting" });
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [logoutPending, setLogoutPending] = useState(false);

  useEffect(
    () => extensionConnection.start(setExtensionState),
    [extensionConnection, connectionAttempt],
  );

  useEffect(() => {
    let active = true;
    setAuthState({ status: "loading" });
    void authClient.discoverSession().then((result) => {
      if (!active) return;
      setAuthState(result);
    });
    return () => { active = false; };
  }, [authClient, authAttempt]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    dataSource
      .listSolutions()
      .then((next) => {
        if (!active) return;
        setRecords(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch(() => {
        if (active) setError("풀이 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [dataSource]);

  async function logout() {
    setLogoutPending(true);
    const ok = await authClient.logout(beforeLogout);
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
              <div className="account-summary">
                {authState.user.avatarUrl && <img src={authState.user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
                <div>
                  <strong>{authState.user.displayName || authState.user.githubLogin}</strong>
                  <small>@{authState.user.githubLogin}</small>
                </div>
                <button type="button" disabled={logoutPending} onClick={() => void logout()}>{logoutPending ? "로그아웃 중" : "로그아웃"}</button>
              </div>
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
                  : "로그인과 자동 동기화 전에는 코드가 전송되지 않습니다."}
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

      {loading ? (
        <p className="state-card" role="status">풀이 목록을 불러오는 중입니다.</p>
      ) : error ? (
        <p className="state-card error" role="alert">{error}</p>
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
                <pre className="code-view"><code>{selected.code}</code></pre>
                <p className="future-note">이 상세 화면은 다음 bounded slice에서 인증된 Main API 데이터와 연결할 수 있습니다.</p>
              </article>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
