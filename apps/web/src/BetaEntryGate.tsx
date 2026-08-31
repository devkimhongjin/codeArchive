import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { checkBetaEntry, tabEntry, type EntryCheck } from "./betaEntry";
import "./styles.css";

interface Props {
  children: ReactNode;
  check?: EntryCheck;
  entry?: typeof tabEntry;
}

export function BetaEntryGate({ children, check = checkBetaEntry, entry = tabEntry }: Props) {
  const [accepted, setAccepted] = useState(() => entry.accepted());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !password.trim()) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await check(password, controller.signal);
      if (controller.signal.aborted) return;
      if (result === "accepted") {
        entry.remember();
        setAccepted(true);
      } else {
        setError(result === "incorrect" ? "비밀번호가 맞지 않아요. 초대받은 비밀번호를 확인해 주세요."
          : "지금은 입장을 확인할 수 없어요. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요.");
      }
    } catch {
      if (!controller.signal.aborted) setError("입장 확인에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (!controller.signal.aborted) {
        setPassword("");
        setBusy(false);
        pending.current = null;
      }
    }
  }

  if (accepted) return <>{children}</>;
  return (
    <main className="beta-entry-shell">
      <section className="beta-entry-card" aria-labelledby="beta-entry-title">
        <p className="eyebrow">CodeArchive · Private beta</p>
        <h1 id="beta-entry-title">초대받으셨나요?</h1>
        <p className="beta-entry-description">테스트를 위해 전달받은 비밀번호를 입력해 주세요.<br />이 탭에서는 한 번만 확인할게요.</p>
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="beta-password">초대 비밀번호</label>
          <input id="beta-password" type="password" autoComplete="off" autoFocus required maxLength={128}
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
            aria-describedby={error ? "beta-entry-error" : undefined} />
          {error && <p id="beta-entry-error" className="beta-entry-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy || !password.trim()}>
            {busy ? "확인 중…" : "Dashboard 입장"}
          </button>
        </form>
        <p className="beta-entry-note">비밀번호는 초대한 사람에게 문의해 주세요.<br />확장 프로그램의 로컬 코드 수집은 그대로 사용할 수 있어요.</p>
      </section>
    </main>
  );
}
