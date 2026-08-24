import { useEffect, useState } from "react";
import type { DetectedProblemInfo, ProblemDetectionResult } from "./adapters/platformAdapter";
import type { SweaEditorInfo } from "./adapters/swea/sweaEditor";
import type { SweaSolvingProblemMeta } from "./adapters/swea/sweaSolvingProblemMeta";
import { requestCurrentPageContext, type PageContextState } from "./content/pageContextBridge";

interface SweaDetectionPanelProps {
  requestContext?: () => Promise<PageContextState>;
  onProblemPrefill(problem: DetectedProblemInfo): void;
  onEditorPrefill(editor: SweaEditorInfo): void;
  onSolvingPrefill(problem: SweaSolvingProblemMeta, editor: SweaEditorInfo): void;
}

function DetectionContent({ result, onProblemPrefill, onEditorPrefill, onSolvingPrefill }: {
  result: ProblemDetectionResult;
  onProblemPrefill(problem: DetectedProblemInfo): void;
  onEditorPrefill(editor: SweaEditorInfo): void;
  onSolvingPrefill(problem: SweaSolvingProblemMeta, editor: SweaEditorInfo): void;
}) {
  if (result.status === "unsupported_page") return <p className="detection-muted">지원되는 SWEA 페이지가 아닙니다.</p>;

  if (result.status === "connected_page") {
    const editor = result.editor;
    const syncFailed = editor.status === "incomplete" && editor.warnings.some((warning) => warning.includes("최신 코드 동기화"));
    const metadata = result.metadata;
    const hasProblemMetadata = metadata.status === "detected";
    return (
      <div className="detection-result">
        <div>
          <strong>SWEA 풀이 페이지 연결됨</strong>
          {hasProblemMetadata && <p>문제: {metadata.problem.problemNumber} · {metadata.problem.title}</p>}
          {metadata.status === "incomplete" && <p className="detection-muted">문제 정보 일부 감지 실패</p>}
          {metadata.status === "conflict" && <p className="detection-muted">SWEA 문제 식별 정보 불일치</p>}
          {editor.status === "detected" ? (
            <>
              <p>언어: {editor.editor.language ?? "미확인"}</p>
              <span>코드: 감지됨 · {editor.editor.code.length.toLocaleString()}자</span>
            </>
          ) : (
            <>
              <p>언어: {editor.language ?? "미확인"}</p>
              <span>{syncFailed ? "최신 코드 동기화 실패" : `코드 편집기 감지 실패 · 누락: ${editor.missing.join(", ")}`}</span>
            </>
          )}
        </div>
        {editor.status === "detected" && (
          <button className="secondary-button" type="button" onClick={() => hasProblemMetadata ? onSolvingPrefill(metadata.problem, editor.editor) : onEditorPrefill(editor.editor)}>
            등록 폼에 채우기
          </button>
        )}
      </div>
    );
  }

  if (result.status === "incomplete") {
    return <div><strong>SWEA 문제 상세 페이지 연결됨</strong><p className="detection-muted">문제 정보 일부 수집 실패 · 누락: {result.missing.join(", ")}</p></div>;
  }

  return (
    <div className="detection-result">
      <div><strong>SWEA 문제 감지</strong><p>{result.problem.problemNumber} · {result.problem.title}</p><span>{result.problem.difficulty ?? "난이도 미확인"}</span></div>
      <button className="secondary-button" type="button" onClick={() => onProblemPrefill(result.problem)}>등록 폼에 채우기</button>
    </div>
  );
}

export function SweaDetectionPanel({ requestContext = requestCurrentPageContext, onProblemPrefill, onEditorPrefill, onSolvingPrefill }: SweaDetectionPanelProps) {
  const [state, setState] = useState<PageContextState>({ status: "loading" });
  useEffect(() => { requestContext().then(setState).catch(() => setState({ status: "unavailable" })); }, [requestContext]);
  return (
    <section className="detection-card" aria-label="현재 페이지 감지">
      {state.status === "loading" && <p className="detection-muted">현재 페이지 확인 중...</p>}
      {state.status === "unavailable" && <p className="detection-muted">Content Script에 연결할 수 없습니다.</p>}
      {state.status === "connected" && <DetectionContent result={state.result} onProblemPrefill={onProblemPrefill} onEditorPrefill={onEditorPrefill} onSolvingPrefill={onSolvingPrefill} />}
    </section>
  );
}
