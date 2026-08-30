import { useEffect, useRef, useState } from "react";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import { AI_TASK_LABELS, AiArtifactRequestError, type AiArtifact, type AiTaskType, type DashboardAiArtifactClient } from "./aiArtifactClient";

interface Props {
  solution: DashboardServerSolution;
  client: DashboardAiArtifactClient;
  disabled: boolean;
  onSessionExpired: () => void;
  onPendingChange: (pending: boolean) => void;
}

export function SolutionAiArtifacts({ solution, client, disabled, onSessionExpired, onPendingChange }: Props) {
  const [opened, setOpened] = useState(false);
  const [records, setRecords] = useState<readonly AiArtifact[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<"list" | "create" | null>(null);
  const [confirming, setConfirming] = useState<AiTaskType | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const wasConfirming = useRef(false);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (wasConfirming.current) trigger.current?.focus();
    wasConfirming.current = Boolean(confirming);
  }, [confirming]);

  async function run(type?: AiTaskType) {
    if (disabled || request.current || (type && (!ready || confirming !== type))) return;
    const abort = new AbortController();
    request.current = abort;
    setOpened(true);
    setPending(type ? "create" : "list");
    setError("");
    setNotice("");
    if (type) onPendingChange(true);
    try {
      if (type) {
        const created = await client.create(solution.id, type, abort.signal);
        if (abort.signal.aborted) return;
        setRecords((current) => [created, ...current.filter((value) => value.id !== created.id)]);
        setConfirming(null);
        setNotice("AI 결과를 별도로 저장했습니다. 원본 코드는 변경하지 않았습니다.");
      } else {
        const listed = await client.list(solution.id, abort.signal);
        if (abort.signal.aborted) return;
        setRecords(listed);
      }
      setReady(true);
    } catch (cause) {
      if (abort.signal.aborted) return;
      setReady(false);
      setConfirming(null);
      if (cause instanceof ArchiveSessionExpiredError) onSessionExpired();
      else if (cause instanceof AiArtifactRequestError && cause.kind === "rate_limit") {
        setError("오늘의 AI 요청 한도에 도달했습니다. 저장된 결과는 새로고침해 확인할 수 있습니다.");
      } else {
        setError(type
          ? "생성 완료를 확인하지 못했습니다. 서버에서 계속 처리될 수 있으니 결과를 새로고침해 확인한 뒤 다시 요청해주세요. 요청 한도가 차감되었을 수 있습니다."
          : "AI 결과를 불러오지 못했습니다. 새로고침해 다시 확인해주세요.");
      }
    } finally {
      if (!abort.signal.aborted) {
        request.current = null;
        setPending(null);
        if (type) onPendingChange(false);
      }
    }
  }

  function cancel() { if (!request.current) setConfirming(null); }

  return (
    <section className="solution-ai" aria-label="AI 도우미" aria-busy={Boolean(pending)}>
      <div className="solution-tool-heading"><strong>AI 도우미</strong><span>서버에 저장된 원본으로 요청하고 결과는 별도로 보관합니다.</span></div>
      <p>AI 실행은 자동 동기화 동의와 별개입니다. 각 요청을 확인해야 코드가 분석 서비스·설정된 AI 제공자에게 전송됩니다. 결과에는 오류가 있을 수 있습니다.</p>
      <button type="button" disabled={disabled || Boolean(pending) || Boolean(confirming)} onClick={() => void run()}>{pending === "list" ? "AI 결과 불러오는 중..." : opened ? "AI 결과 새로고침" : "AI 도우미 열기"}</button>
      {opened && <>
        <div className="solution-tool-actions">
          {(Object.keys(AI_TASK_LABELS) as AiTaskType[]).map((type) => (
            <button key={type} type="button" disabled={disabled || !ready || Boolean(pending) || Boolean(confirming)} onClick={(event) => { trigger.current = event.currentTarget; setConfirming(type); setNotice(""); }}>{AI_TASK_LABELS[type]}</button>
          ))}
        </div>
        {confirming && <section className="ai-confirm" aria-label="AI 요청 확인" onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}>
          <strong>{AI_TASK_LABELS[confirming]} 요청을 실행할까요?</strong>
          <p>{solution.platform} · {solution.problemNumber} · {solution.title} · {solution.language}</p>
          <p>서버에 저장된 코드와 문제 메타데이터를 분석 서비스·설정된 AI 제공자에게 전송합니다. 요청 한도가 차감되며 최대 2분 정도 걸릴 수 있습니다.</p>
          <p>화면을 떠나도 서버 처리는 계속될 수 있습니다. 테스트용 fake 제공자가 설정된 경우 실제 AI 대신 테스트 결과가 저장됩니다.</p>
          <div className="solution-tool-actions">
            <button ref={cancelButton} type="button" disabled={Boolean(pending)} onClick={cancel}>AI 요청 취소</button>
            <button className="primary-button" type="button" disabled={disabled || Boolean(pending)} onClick={() => void run(confirming)}>{pending === "create" ? "AI 생성 중..." : "전송 동의 후 AI 실행"}</button>
          </div>
        </section>}
        {ready && records.length === 0 && <p>아직 저장된 AI 결과가 없습니다.</p>}
        {records.length > 0 && <div className="ai-results" aria-label="저장된 AI 결과">
          <p>이전에 생성한 결과는 수정 전 코드 기준일 수 있습니다. 원본과 비교해 확인하세요.</p>
          {records.map((record) => <details key={record.id} open={records.length === 1}>
            <summary>{AI_TASK_LABELS[record.type]} · {record.createdAt}</summary>
            <p>{record.provider.toLowerCase() === "fake" ? "테스트용 결과 · 실제 AI 분석 아님 · " : ""}{record.provider} / {record.model}</p>
            <pre className="ai-content">{record.content}</pre>
          </details>)}
        </div>}
      </>}
      {notice && <p className="tool-feedback" role="status">{notice}</p>}
      {error && <p className="tool-error" role="alert">{error}</p>}
    </section>
  );
}
