import { useEffect, useState } from "react";
import type { DetectedProblemInfo, ProblemDetectionResult } from "./adapters/platformAdapter";
import { requestCurrentPageContext, type PageContextState } from "./content/pageContextBridge";

interface SweaDetectionPanelProps {
  requestContext?: () => Promise<PageContextState>;
  onPrefill(problem: DetectedProblemInfo): void;
}

function DetectionContent({ result, onPrefill }: { result: ProblemDetectionResult; onPrefill(problem: DetectedProblemInfo): void }) {
  if (result.status === "unsupported_page") {
    return <p className="detection-muted">지원되는 SWEA 페이지가 아닙니다.</p>;
  }

  if (result.status === "connected_page") {
    return (
      <div>
        <strong>SWEA 풀이 페이지 연결됨</strong>
        <p className="detection-muted">문제 메타데이터는 아직 수집하지 않습니다.</p>
      </div>
    );
  }

  if (result.status === "incomplete") {
    return (
      <div>
        <strong>SWEA 문제 상세 페이지 연결됨</strong>
        <p className="detection-muted">문제 정보 일부 수집 실패 · 누락: {result.missing.join(", ")}</p>
      </div>
    );
  }

  return (
    <div className="detection-result">
      <div>
        <strong>SWEA 문제 감지</strong>
        <p>{result.problem.problemNumber} · {result.problem.title}</p>
        <span>{result.problem.difficulty ?? "난이도 미확인"}</span>
      </div>
      <button className="secondary-button" type="button" onClick={() => onPrefill(result.problem)}>
        등록 폼에 채우기
      </button>
    </div>
  );
}

export function SweaDetectionPanel({ requestContext = requestCurrentPageContext, onPrefill }: SweaDetectionPanelProps) {
  const [state, setState] = useState<PageContextState>({ status: "loading" });

  useEffect(() => {
    requestContext().then(setState).catch(() => setState({ status: "unavailable" }));
  }, [requestContext]);

  return (
    <section className="detection-card" aria-label="현재 페이지 감지">
      {state.status === "loading" && <p className="detection-muted">현재 페이지 확인 중...</p>}
      {state.status === "unavailable" && <p className="detection-muted">Content Script에 연결할 수 없습니다.</p>}
      {state.status === "connected" && <DetectionContent result={state.result} onPrefill={onPrefill} />}
    </section>
  );
}
