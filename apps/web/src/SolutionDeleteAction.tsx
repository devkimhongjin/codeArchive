import { useEffect, useRef, useState } from "react";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import type { DashboardSolutionDeleteClient } from "./solutionDeleteClient";

interface Props {
  solution: DashboardServerSolution;
  client: DashboardSolutionDeleteClient;
  disabled: boolean;
  onDeleted: (id: string) => void;
  onSessionExpired: () => void;
  onPendingChange: (pending: boolean) => void;
}

export function SolutionDeleteAction({ solution, client, disabled, onDeleted, onSessionExpired, onPendingChange }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (wasConfirming.current) openButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  function cancel() {
    if (request.current) return;
    setConfirming(false);
    setError("");
  }

  async function remove() {
    if (!confirming || disabled || request.current) return;
    const abort = new AbortController();
    request.current = abort;
    setPending(true);
    onPendingChange(true);
    setError("");
    try {
      await client.deleteSolution(solution.id, abort.signal);
      if (!abort.signal.aborted) onDeleted(solution.id);
    } catch (cause) {
      if (abort.signal.aborted) return;
      if (cause instanceof ArchiveSessionExpiredError) onSessionExpired();
      else setError("삭제 완료를 확인하지 못했습니다. 목록을 새로고침해 상태를 확인한 뒤 다시 시도해주세요.");
    } finally {
      if (!abort.signal.aborted) {
        request.current = null;
        setPending(false);
        onPendingChange(false);
      }
    }
  }

  return (
    <div className="solution-delete-action">
      <button ref={openButton} className="danger-button" type="button" disabled={disabled || pending || confirming} onClick={() => setConfirming(true)}>서버에서 삭제</button>
      {confirming && (
        <section className="solution-delete-confirm" aria-label="서버 풀이 삭제 확인" aria-busy={pending} onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}>
          <strong>이 서버 풀이를 삭제할까요?</strong>
          <p>{solution.platform} · {solution.problemNumber} · {solution.title} · {solution.language}</p>
          <p>서버에서 삭제하면 되돌릴 수 없습니다. Extension의 로컬 원본과 동기화 확인 기록은 삭제하지 않습니다.</p>
          <p>아직 동기화 대기 중인 원본은 이후 동기화로 서버에 다시 저장될 수 있습니다.</p>
          <div className="solution-tool-actions">
            <button ref={cancelButton} type="button" disabled={pending} onClick={cancel}>삭제 취소</button>
            <button className="danger-button" type="button" disabled={disabled || pending} onClick={() => void remove()}>{pending ? "삭제 중..." : "삭제 확인"}</button>
          </div>
          {error && <p className="tool-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
