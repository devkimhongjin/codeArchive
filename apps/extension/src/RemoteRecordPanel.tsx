import { useEffect, useMemo, useState } from "react";
import { AuthLoginStageError, authLoginFailureMessage } from "./authDiagnostics";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";
import { syncSolutionRecord } from "./solutionSync";
import type { AuthViewState, CodeArchiveAuthService } from "./authSession";
import { AiApiError, codeArchiveAiApi, type AiArtifact, type AiArtifactType, type CodeArchiveAiApi } from "./aiArtifacts";
import { clearForeignSyncOwnership } from "./syncOwnership";

const AI_ACTIONS: Array<{ type: AiArtifactType; label: string }> = [
  { type: "APPROACH_DESIGN", label: "접근 및 설계 작성" },
  { type: "COMMENTED_CODE", label: "코드 주석 추가" },
  { type: "CODE_REVIEW", label: "코드 리뷰" },
];

interface RemoteRecordPanelProps {
  record: SolutionRecord;
  repository: SolutionRepository;
  authService: CodeArchiveAuthService;
  aiApi?: CodeArchiveAiApi;
  onRecordChange?(record: SolutionRecord): void;
}

function safeAiMessage(error: unknown): string {
  if (error instanceof AiApiError) {
    if (error.kind === "rate_limit") return "오늘의 AI 요청 한도를 초과했습니다. 나중에 다시 시도해주세요.";
    if (error.kind === "auth") return "로그인이 만료되었습니다. 다시 로그인해주세요.";
  }
  return "AI 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export function RemoteRecordPanel({ record, repository, authService, aiApi = codeArchiveAiApi, onRecordChange }: RemoteRecordPanelProps) {
  const [auth, setAuth] = useState<AuthViewState>({ status: authService.isConfigured() ? "signed_out" : "unavailable" });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [artifacts, setArtifacts] = useState<AiArtifact[]>([]);

  async function applyAuthState(state: AuthViewState): Promise<void> {
    if (state.status === "authenticated") {
      const reconciled = await clearForeignSyncOwnership(repository, state.user.id);
      const current = reconciled.find((item) => item.id === record.id);
      if (current && current.sync !== record.sync) onRecordChange?.(current);
    }
    setAuth(state);
  }

  useEffect(() => {
    let active = true;
    authService.restore().then(async (state) => {
      if (!active) return;
      if (state.status === "authenticated") {
        const reconciled = await clearForeignSyncOwnership(repository, state.user.id);
        if (!active) return;
        const current = reconciled.find((item) => item.id === record.id);
        if (current && current.sync !== record.sync) onRecordChange?.(current);
      }
      if (active) setAuth(state);
    }).catch(() => { if (active) setAuth({ status: "signed_out" }); });
    return () => { active = false; };
  }, [authService, repository, record.id]);

  const currentUserKey = auth.status === "authenticated" ? auth.user.id : undefined;
  const syncState = useMemo(() => {
    if (!currentUserKey || !record.sync || record.sync.userKey !== currentUserKey) return "local_only" as const;
    return record.sync.state;
  }, [currentUserKey, record.sync]);
  const canUseAi = auth.status === "authenticated" && syncState === "synced" && Boolean(record.sync?.serverSolutionId);

  useEffect(() => {
    let active = true;
    if (!canUseAi || auth.status !== "authenticated" || !record.sync?.serverSolutionId) {
      setArtifacts([]);
      return () => { active = false; };
    }
    authService.getAuthenticatedSession().then(async (session) => {
      if (!session) {
        if (active) setAuth({ status: "signed_out" });
        return;
      }
      try {
        const items = await aiApi.list(session, record.sync!.serverSolutionId!);
        if (active) setArtifacts(items);
      } catch (error) {
        if (error instanceof AiApiError && error.kind === "auth" && active) setAuth({ status: "signed_out" });
      }
    });
    return () => { active = false; };
  }, [aiApi, auth.status, authService, canUseAi, record.sync?.serverSolutionId]);

  async function login() {
    if (busy) return;
    setBusy("login"); setMessage("");
    try { await applyAuthState(await authService.login()); }
    catch (error) { setMessage(authLoginFailureMessage(error instanceof AuthLoginStageError ? error.stage : "auth_failed")); }
    finally { setBusy(null); }
  }

  async function logout() {
    if (busy) return;
    setBusy("logout"); setMessage("");
    await authService.logout();
    setAuth({ status: "signed_out" });
    setArtifacts([]);
    setBusy(null);
  }

  async function retrySync() {
    if (busy) return;
    setBusy("sync"); setMessage("");
    try {
      await syncSolutionRecord(record.id, { repository, authProvider: authService });
      const updated = await repository.getById(record.id);
      if (updated) onRecordChange?.(updated);
      await applyAuthState(await authService.restore());
      setMessage(updated?.sync?.state === "synced" ? "동기화되었습니다." : "동기화하지 못했습니다. 다시 시도할 수 있습니다.");
    } catch {
      setMessage("동기화하지 못했습니다. 로컬 기록은 그대로 유지됩니다.");
    } finally { setBusy(null); }
  }

  async function createArtifact(type: AiArtifactType) {
    if (busy || !canUseAi || auth.status !== "authenticated" || !record.sync?.serverSolutionId) return;
    setBusy(type); setMessage("");
    try {
      const session = await authService.getAuthenticatedSession();
      if (!session) { setAuth({ status: "signed_out" }); return; }
      const artifact = await aiApi.create(session, record.sync.serverSolutionId, type);
      setArtifacts((items) => [artifact, ...items]);
    } catch (error) {
      if (error instanceof AiApiError && error.kind === "auth") setAuth({ status: "signed_out" });
      setMessage(safeAiMessage(error));
    } finally { setBusy(null); }
  }

  return <section className="remote-panel" aria-label="CodeArchive 서버 및 AI">
    <div className="section-heading"><h3>서버 동기화 · AI</h3></div>
    {auth.status === "unavailable" ? <p className="form-hint">Main API 주소가 아직 설정되지 않아 로컬 기능만 사용합니다.</p> : auth.status === "signed_out" ? <button className="secondary-button" type="button" onClick={login} disabled={busy !== null}>{busy === "login" ? "로그인 중..." : "GitHub로 로그인"}</button> : <div className="auth-user"><div>{auth.user.avatarUrl && <img src={auth.user.avatarUrl} alt="" width="28" height="28" />}<strong>@{auth.user.githubLogin}</strong></div><button className="text-button" type="button" onClick={logout} disabled={busy !== null}>로그아웃</button></div>}

    <p className="sync-state">동기화 상태: {syncState === "synced" ? "동기화됨" : syncState === "retryable" ? "재시도 필요" : "로컬 전용"}</p>
    {auth.status === "authenticated" && syncState !== "synced" && <button className="secondary-button" type="button" onClick={retrySync} disabled={busy !== null}>{busy === "sync" ? "동기화 중..." : "다시 동기화"}</button>}

    <div className="ai-actions">
      {AI_ACTIONS.map((action) => <button key={action.type} type="button" onClick={() => createArtifact(action.type)} disabled={!canUseAi || busy !== null}>{busy === action.type ? "생성 중..." : action.label}</button>)}
    </div>
    {!canUseAi && <p className="form-hint">AI 기능은 로그인 후 현재 계정으로 동기화된 풀이에서만 사용할 수 있습니다.</p>}
    <p className="form-hint">AI 기능 사용 시 저장된 풀이 소스가 서버에 설정된 외부 AI 제공자에게 전송될 수 있습니다.</p>
    {message && <p className="status" role="status">{message}</p>}
    {artifacts.length > 0 && <div className="artifact-list">{artifacts.map((artifact) => <article key={artifact.id} className="artifact-card"><strong>{AI_ACTIONS.find((action) => action.type === artifact.type)?.label ?? artifact.type}</strong><pre className="code-view"><code>{artifact.content}</code></pre></article>)}</div>}
  </section>;
}
