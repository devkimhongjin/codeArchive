import { useEffect, useRef, useState } from "react";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { githubErrorMessage, GitHubRequestError, type GitHubAutoStatus, type GitHubAutoTarget, type GitHubClient } from "./githubClient";
import type { CodeArchiveAutomationControlErrorCode } from "../../../packages/shared-types/src";

type AutomationIntent = { enabled: boolean; nonce: number };
type AutomationStateCallback = (enabled: boolean, errorCode: CodeArchiveAutomationControlErrorCode | null) => void;

function automationError(error: unknown): CodeArchiveAutomationControlErrorCode | null {
  if (!(error instanceof GitHubRequestError)) return null;
  if (error.code === "GITHUB_UPLOAD_OUTCOME_UNKNOWN" || error.code === "GITHUB_UPLOAD_ALREADY_ATTEMPTED") return "GITHUB_OUTCOME_UNKNOWN";
  if (error.code === "GITHUB_REFERENCE_CHANGED" || error.code === "GITHUB_UPLOAD_TARGET_CHANGED") return "GITHUB_TARGET_CHANGED";
  if (error.code === "GITHUB_AUTO_STOPPED" || error.code === "GITHUB_AUTO_ACTIVE") return "LEASE_FAILED";
  return null;
}

export function GitHubAutoCommit({ client, target, eligible, blocked, onLock, onSessionExpired, automationIntent, onAutomationStateChange, refreshTarget }: {
  client: GitHubClient; target: GitHubAutoTarget | null; eligible: boolean; blocked: boolean;
  onLock: (locked: boolean) => void; onSessionExpired: () => void;
  automationIntent?: AutomationIntent | null; onAutomationStateChange?: AutomationStateCallback;
  refreshTarget?: (signal: AbortSignal) => Promise<GitHubAutoTarget>;
}) {
  const [status, setStatus] = useState<GitHubAutoStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "enabling" | "running" | "stopping">("idle");
  const [consent, setConsent] = useState(false);
  const [risk, setRisk] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [notice, setNotice] = useState("");
  const [checked, setChecked] = useState(false);
  const run = useRef<string | null>(null);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const callbacks = useRef({ onLock, onSessionExpired, onAutomationStateChange }); callbacks.current = { onLock, onSessionExpired, onAutomationStateChange };
  const fingerprint = JSON.stringify(target);
  const previousFingerprint = useRef(fingerprint);
  useEffect(() => {
    if (previousFingerprint.current !== fingerprint && run.current) {
      void stopRef.current();
      callbacks.current.onAutomationStateChange?.(false, "GITHUB_TARGET_CHANGED");
    }
    previousFingerprint.current = fingerprint;
    setConsent(false); setRisk(false); setPublicConsent(false);
  }, [fingerprint]);

  function report(error: unknown) {
    if (error instanceof ArchiveSessionExpiredError) callbacks.current.onSessionExpired();
    else setNotice(githubErrorMessage(error));
    callbacks.current.onAutomationStateChange?.(false, automationError(error));
  }
  async function stop() {
    if (phaseRef.current === "stopping") return;
    const id = run.current ?? status?.runId;
    request.current?.abort();
    phaseRef.current = "stopping"; setPhase("stopping"); callbacks.current.onLock(true);
    setConsent(false); setRisk(false); setPublicConsent(false);
    if (!id) { phaseRef.current = "idle"; setPhase("idle"); callbacks.current.onLock(false); callbacks.current.onAutomationStateChange?.(false, null); return; }
    run.current = id;
    setNotice("자동 요청을 멈췄습니다. 서버 OFF 확인 중입니다. 이미 시작된 전송은 회수할 수 없습니다.");
    try {
      const value = await client.autoStop(id);
      if (!active.current || run.current !== id) return;
      run.current = null; setStatus(value); phaseRef.current = "idle"; setPhase("idle"); callbacks.current.onLock(false);
      callbacks.current.onAutomationStateChange?.(false, null);
      setNotice("자동 커밋 OFF · 전송된 코드는 유지됩니다. 다시 켜도 과거 풀이는 자동 업로드하지 않습니다.");
    } catch (error) {
      if (!active.current) return;
      report(error);
      setNotice("서버 OFF 확인에 실패했습니다. OFF 확인을 다시 눌러 주세요. 새 자동 요청은 중단되며 서버 실행 권한은 마지막 요청 후 최대 60초에 만료됩니다. 이미 시작된 전송은 완료될 수 있습니다.");
    }
  }
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void client.autoStatus(undefined, controller.signal).then(value => {
      if (!active.current || controller.signal.aborted) return;
      setStatus(value); setChecked(true);
      // Discovery is read-only. An existing run is never resumed by a new page.
      if (value.state === "ACTIVE" || value.state === "STARTING") setNotice("다른 화면의 실행 상태입니다. 이 화면에서는 자동 실행을 이어받지 않습니다. 먼저 OFF로 바꿔 주세요.");
    }).catch(error => { if (!controller.signal.aborted && active.current) report(error); });
    const halt = () => { if (run.current) void stopRef.current(); };
    window.addEventListener("pagehide", halt); window.addEventListener("offline", halt);
    return () => {
      active.current = false; controller.abort(); request.current?.abort();
      window.removeEventListener("pagehide", halt); window.removeEventListener("offline", halt);
      const id = run.current; run.current = null;
      if (id) void client.autoStop(id).catch(() => undefined);
    };
  }, [client]);
  useEffect(() => { if (!eligible && run.current && phaseRef.current !== "stopping") void stopRef.current(); }, [eligible]);

  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      const id = run.current;
      if (cancelled || !id || phaseRef.current !== "running") return;
      if (!eligible) { void stopRef.current(); return; }
      const controller = new AbortController(); request.current = controller;
      try {
        const value = await client.autoTick(id, controller.signal);
        if (cancelled || !active.current || run.current !== id || phaseRef.current !== "running") return;
        setStatus(value);
        if (value.state !== "ACTIVE" || value.lastResult?.status === "UNKNOWN") {
          const stopError = value.lastResult?.status === "UNKNOWN" ? "GITHUB_OUTCOME_UNKNOWN" : value.state !== "ACTIVE" ? "LEASE_FAILED" : null;
          await stopRef.current();
          if (stopError) callbacks.current.onAutomationStateChange?.(false, stopError);
          return;
        }
        timer = setTimeout(() => void tick(), 10_000);
      } catch (error) {
        if (cancelled || !active.current || controller.signal.aborted) return;
        report(error);
        await stopRef.current();
        const code = automationError(error);
        if (code) callbacks.current.onAutomationStateChange?.(false, code);
        if (active.current) setNotice(githubErrorMessage(error));
      }
    }
    timer = setTimeout(() => void tick(), 1_000);
    return () => { cancelled = true; clearTimeout(timer); request.current?.abort(); };
  }, [phase, client, eligible]);

  async function enable(automation = false) {
    if (!target || !eligible || blocked || !checked || phaseRef.current !== "idle") return;
    if (status?.state === "ACTIVE" || status?.state === "STARTING") {
      if (automation) { setNotice("다른 화면의 자동 커밋이 실행 중입니다. 먼저 OFF로 바꿔 주세요."); callbacks.current.onAutomationStateChange?.(false, "LEASE_FAILED"); }
      return;
    }
    if (!consent || !risk) {
      if (automation) { setNotice("자동 커밋 동의가 필요합니다. Dashboard에서 자동 전송 동의를 먼저 확인해 주세요."); callbacks.current.onAutomationStateChange?.(false, "GITHUB_CONSENT_REQUIRED"); }
      return;
    }
    if (!target.privateRepository && !publicConsent) {
      if (automation) { setNotice("공개 저장소 자동 공개 동의가 필요합니다."); callbacks.current.onAutomationStateChange?.(false, "PUBLIC_REPOSITORY_CONSENT_REQUIRED"); }
      return;
    }
    const controller = new AbortController(); request.current = controller;
    let currentTarget: GitHubAutoTarget;
    try {
      currentTarget = refreshTarget ? await refreshTarget(controller.signal) : target;
    } catch (error) {
      if (!active.current || controller.signal.aborted) return;
      report(error); request.current = null; return;
    }
    if (!active.current || controller.signal.aborted) return;
    const id = crypto.randomUUID(); run.current = id;
    phaseRef.current = "enabling"; setPhase("enabling"); callbacks.current.onLock(true); setNotice("");
    try {
      const value = await client.autoEnable(id, { target: currentTarget, confirmAutomatic: consent, acknowledgeVisibilityRisk: risk, confirmPublicUpload: publicConsent }, controller.signal);
      if (!active.current || run.current !== id || phaseRef.current !== "enabling") return;
      setStatus(value);
      if (value.state !== "ACTIVE") { await stop(); callbacks.current.onAutomationStateChange?.(false, "LEASE_FAILED"); return; }
      phaseRef.current = "running"; setPhase("running");
      callbacks.current.onAutomationStateChange?.(true, null);
    } catch (error) {
      if (!active.current || phaseRef.current !== "enabling") return;
      await stop();
      if (active.current) report(error);
    }
  }
  const appliedIntent = useRef(-1);
  useEffect(() => {
    const intent = automationIntent;
    if (!intent || appliedIntent.current === intent.nonce) return;
    if (intent.enabled && (!checked || !target)) return;
    appliedIntent.current = intent.nonce;
    if (intent.enabled) void enable(true);
    else if (run.current || phaseRef.current !== "idle") void stop();
    else callbacks.current.onAutomationStateChange?.(false, null);
  }, [automationIntent?.nonce, automationIntent?.enabled, checked, fingerprint]);
  const otherRun = status?.state === "ACTIVE" || status?.state === "STARTING";
  const locked = phase !== "idle";
  return <section className="github-auto" aria-label="자동 풀이 커밋">
    <div className="github-heading"><h3>자동 풀이 커밋</h3><strong className={`badge ${phase === "running" ? "github-on" : ""}`}>{phase === "running" ? "ON" : phase === "enabling" ? "ON 확인 중" : phase === "stopping" ? "OFF 확인 중" : otherRun ? "다른 화면에서 ON" : "OFF"}</strong></div>
    <p>Dashboard가 살아 있고 자동 동기화·Extension 연결·온라인 상태가 유지되는 동안, background에서도 ON 이후 새로 수집·저장된 정답 풀이를 커밋합니다. 페이지 종료·연결 해제·로그아웃 시 꺼집니다.</p>
    <p>경로: <code>{target?.folder ? `${target.folder}/` : ""}{"{플랫폼}/{문제번호}/Solution.{언어 확장자}"}</code> · 기존 파일은 덮어쓰지 않습니다. 과거 풀이·실패한 요청은 자동 재시도하지 않습니다.</p>
    {!eligible && <p>자동 동기화를 켜고 Extension을 연결해야 ON으로 바꿀 수 있습니다.</p>}
    <fieldset disabled={locked || !!otherRun || blocked}>
      <legend>자동 전송 동의</legend>
      <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />선택한 저장소·브랜치·폴더로 새 풀이 코드를 자동 전송하는 데 동의합니다.</label>
      <label><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)} />비공개 저장소도 공개로 바뀔 수 있고, OFF로 바꿔도 전송한 코드는 회수되지 않음을 확인했습니다.</label>
      {target && !target.privateRepository && <label><input type="checkbox" checked={publicConsent} onChange={e => setPublicConsent(e.target.checked)} />공개 저장소에 새 풀이 코드가 자동 공개되는 데 동의합니다.</label>}
    </fieldset>
    <div className="github-actions">
      <button type="button" disabled={!checked || !target || !eligible || blocked || locked || !!otherRun || !consent || !risk || (!target.privateRepository && !publicConsent)} onClick={() => void enable()}>자동 커밋 ON</button>
      <button type="button" disabled={!locked && !otherRun} onClick={() => void stop()}>{phase === "stopping" ? "OFF 확인 다시 시도" : "자동 커밋 OFF"}</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {status?.lastResult && <p>마지막 자동 처리: {status.lastResult.status === "SUCCEEDED" ? "커밋 완료" : status.lastResult.status === "UNKNOWN" ? "결과 확인 필요 · 재전송 금지" : "중단됨"}
      {status.lastResult.commitUrl && <a href={status.lastResult.commitUrl} target="_blank" rel="noopener noreferrer"> GitHub 커밋 보기</a>}</p>}
  </section>;
}
