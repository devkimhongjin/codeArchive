import { useEffect, useState } from "react";
import { AuthLoginStageError, authLoginFailureMessage } from "./authDiagnostics";
import type { AuthViewState, CodeArchiveAuthService } from "./authSession";
import type { SolutionRepository } from "./solutionRepository";
import { clearForeignSyncOwnership } from "./syncOwnership";

interface PopupAuthPanelProps {
  authService: CodeArchiveAuthService;
  repository: SolutionRepository;
  onRecordsChange?(): Promise<void> | void;
}

export function PopupAuthPanel({ authService, repository, onRecordsChange }: PopupAuthPanelProps) {
  const [auth, setAuth] = useState<AuthViewState>({ status: authService.isConfigured() ? "signed_out" : "unavailable" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function applyAuthState(state: AuthViewState) {
    if (state.status === "authenticated") {
      await clearForeignSyncOwnership(repository, state.user.id);
      await onRecordsChange?.();
    }
    setAuth(state);
  }

  useEffect(() => {
    let active = true;
    authService.restore()
      .then(async (state) => {
        if (!active) return;
        if (state.status === "authenticated") {
          await clearForeignSyncOwnership(repository, state.user.id);
          if (!active) return;
          await onRecordsChange?.();
        }
        if (active) setAuth(state);
      })
      .catch(() => { if (active) setAuth({ status: "signed_out" }); });
    return () => { active = false; };
  }, [authService, repository]);

  async function login() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await applyAuthState(await authService.login());
    } catch (error) {
      setMessage(authLoginFailureMessage(error instanceof AuthLoginStageError ? error.stage : "auth_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await authService.logout();
      setAuth({ status: "signed_out" });
    } finally {
      setBusy(false);
    }
  }

  return <section className="remote-panel popup-auth-panel" aria-label="CodeArchive 계정">
    <div className="section-heading"><h2>CodeArchive 계정</h2></div>
    {auth.status === "unavailable" ? (
      <p className="form-hint">Main API를 사용할 수 없어 로컬 기능만 사용합니다.</p>
    ) : auth.status === "signed_out" ? (
      <button className="secondary-button" type="button" onClick={login} disabled={busy}>
        {busy ? "로그인 중..." : "GitHub로 로그인"}
      </button>
    ) : (
      <div className="auth-user">
        <div>
          {auth.user.avatarUrl && <img src={auth.user.avatarUrl} alt="" width="28" height="28" />}
          <strong>@{auth.user.githubLogin}</strong>
        </div>
        <button className="text-button" type="button" onClick={logout} disabled={busy}>
          {busy ? "처리 중..." : "로그아웃"}
        </button>
      </div>
    )}
    {message && <p className="status" role="status">{message}</p>}
  </section>;
}
