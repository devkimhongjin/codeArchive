import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_STARTUP_TIMEOUT_MS, checkApiReadiness, type ReadinessCheck, type ReadinessFailure } from "./apiReadiness";
import "./styles.css";

type State = { status: "checking" | "ready" | "cancelled" }
  | { status: "unavailable"; reason: ReadinessFailure };
const failureText: Record<ReadinessFailure, string> = {
  network: "연결이 지연되거나 네트워크에서 응답을 받지 못했어요. 네트워크 상태를 확인한 후 다시 시도해 주세요.",
  server: "서버가 아직 준비되지 않았거나 일시적인 오류가 있어요. 잠시 후 다시 시도해 주세요.",
  response: "예상한 서버 상태를 확인하지 못했어요. 다시 시도해도 같으면 운영자에게 문의해 주세요.",
};
const startupSeconds = API_STARTUP_TIMEOUT_MS / 1000;

export function ApiReadinessGate({ children, check = checkApiReadiness }: { children: ReactNode; check?: ReadinessCheck }) {
  const [state, setState] = useState<State>({ status: "checking" });
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    const started = Date.now();
    setState({ status: "checking" });
    setElapsed(0);
    const timer = globalThis.setInterval(() => {
      setElapsed(Math.min(Math.floor((Date.now() - started) / 1000), startupSeconds));
    }, 1000);
    void (async () => {
      try {
        const result = await check(controller.signal);
        if (!controller.signal.aborted) setState(result);
      } catch {
        if (!controller.signal.aborted) setState({ status: "unavailable", reason: "network" });
      } finally {
        globalThis.clearInterval(timer);
        if (pending.current === controller) pending.current = null;
      }
    })();
    controller.signal.addEventListener("abort", () => globalThis.clearInterval(timer), { once: true });
    return () => { controller.abort(); globalThis.clearInterval(timer); };
  }, [check, run]);

  useEffect(() => {
    if (state.status === "cancelled" || state.status === "unavailable") retryButton.current?.focus();
  }, [state.status]);

  if (state.status === "ready") return <>{children}</>;
  const checking = state.status === "checking";
  return (
    <main className="beta-entry-shell">
      <section className="beta-entry-card" aria-labelledby="api-startup-title">
        <p className="eyebrow">CodeArchive · Private beta</p>
        <h1 id="api-startup-title">{checking ? "서버를 준비하고 있어요" : state.status === "cancelled" ? "대기를 취소했어요" : "서버 연결을 확인해 주세요"}</h1>
        <p className="beta-entry-description" role="status">
          {checking ? `무료 서버가 쉬고 있었다면 처음 연결할 때 시간이 걸릴 수 있어요. 최대 ${startupSeconds / 60}분 동안 상태를 확인할게요.`
            : state.status === "unavailable" ? failureText[state.reason] : "요청을 멈췄어요. 원할 때 다시 확인할 수 있어요."}
        </p>
        {checking && <p className="api-startup-elapsed">경과 {elapsed}초 / 최대 {startupSeconds}초</p>}
        <div className="api-startup-actions">
          {checking ? <button type="button" onClick={() => {
            pending.current?.abort();
            pending.current = null;
            setState({ status: "cancelled" });
          }}>대기 취소</button> : <button ref={retryButton} className="primary-button" type="button" onClick={() => {
            setState({ status: "checking" });
            setRun((value) => value + 1);
          }}>다시 확인</button>}
        </div>
        <p className="beta-entry-note">지금은 서버 상태만 확인해요. 로그인·코드 전송은 시작하지 않아요.<br />확장 프로그램의 로컬 코드 수집과 보관함은 그대로 사용할 수 있어요.</p>
      </section>
    </main>
  );
}
