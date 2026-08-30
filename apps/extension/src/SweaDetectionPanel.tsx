import { useEffect, useState } from "react";
import type { ProblemDetectionResult } from "./adapters/platformAdapter";
import { requestCurrentPageContext, type PageContextState } from "./content/pageContextBridge";
import { formatKstDateTime } from "./displayTime";
import type { SolutionRecord } from "./solution";
import { solutionProvenance } from "./solutionPresentation";

interface SweaDetectionPanelProps {
  requestContext?: () => Promise<PageContextState>;
  savedRecords?: SolutionRecord[];
}

function DetectionContent({ result, savedRecords }: {
  result: ProblemDetectionResult;
  savedRecords: SolutionRecord[];
}) {
  if (result.status === "unsupported_page") return <p className="detection-muted">지원되는 SWEA 페이지가 아닙니다.</p>;

  if (result.status === "connected_page") {
    const editor = result.editor;
    const syncFailed = editor.status === "incomplete" && editor.warnings.some((warning) => warning.includes("최신 코드 동기화"));
    const metadata = result.metadata;
    const hasProblemMetadata = metadata.status === "detected";
    const submissionResult = result.submissionResult;
    const autoSave = result.autoSave ?? { status: "idle" };
    const latestSaved = hasProblemMetadata
      ? savedRecords.find((record) => record.platform === "SWEA" && record.problemNumber === metadata.problem.problemNumber)
      : undefined;

    return (
      <div className="detection-result">
        <div>
          <strong>SWEA 풀이 페이지 연결됨</strong>
          {hasProblemMetadata && <p>문제: {metadata.problem.problemNumber} · {metadata.problem.title}</p>}
          {metadata.status === "incomplete" && <p className="detection-muted">문제 정보 일부 감지 실패</p>}
          {metadata.status === "conflict" && <p className="detection-muted">SWEA 문제 식별 정보 불일치</p>}
          {submissionResult.status === "none" && <p className="detection-muted">현재 세션 제출 결과: 감지 전</p>}
          {submissionResult.status === "observed" && <p>현재 세션 제출 결과: {submissionResult.submission.result} · 관찰 시각: {formatKstDateTime(submissionResult.submission.observedAt)}</p>}
          {latestSaved && <p>최근 저장: {solutionProvenance(latestSaved)}</p>}
          {autoSave.status === "saved" && <p>자동 저장 완료</p>}
          {autoSave.status === "duplicate" && <p>이미 처리된 제출</p>}
          {autoSave.status === "failed" && <p>{autoSave.reason === "confirmation_unknown" ? "저장 여부 확인 필요" : "자동 저장 실패 · 수동 저장을 이용해주세요"}</p>}
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
      </div>
    );
  }

  if (result.status === "incomplete") {
    return <div><strong>SWEA 문제 상세 페이지 연결됨</strong><p className="detection-muted">문제 정보 일부 수집 실패 · 누락: {result.missing.join(", ")}</p></div>;
  }

  return (
    <div className="detection-result">
      <div><strong>SWEA 문제 감지</strong><p>{result.problem.problemNumber} · {result.problem.title}</p><span>{result.problem.difficulty ?? "난이도 미확인"}</span></div>
    </div>
  );
}

export function SweaDetectionPanel({ requestContext = requestCurrentPageContext, savedRecords = [] }: SweaDetectionPanelProps) {
  const [state, setState] = useState<PageContextState>({ status: "loading" });
  useEffect(() => { requestContext().then(setState).catch(() => setState({ status: "unavailable" })); }, [requestContext]);
  return (
    <section className="detection-card" aria-label="현재 페이지 감지">
      {state.status === "loading" && <p className="detection-muted">현재 페이지 확인 중...</p>}
      {state.status === "unavailable" && <p className="detection-muted">Content Script에 연결할 수 없습니다.</p>}
      {state.status === "connected" && <DetectionContent result={state.result} savedRecords={savedRecords} />}
    </section>
  );
}
