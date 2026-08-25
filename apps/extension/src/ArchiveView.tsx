import { useEffect, useState } from "react";
import "./popup.css";
import type { SolutionRecord } from "./solution";
import { indexedDbSolutionRepository, type SolutionRepository } from "./solutionRepository";
import { formatKstDateTime } from "./displayTime";
import { solutionDisplayTime, solutionProvenance } from "./solutionPresentation";

interface ArchiveProps {
  repository?: SolutionRepository;
  copyText?: (text: string) => Promise<void>;
}

export function Archive({
  repository = indexedDbSolutionRepository,
  copyText = (text) => navigator.clipboard.writeText(text),
}: ArchiveProps) {
  const [records, setRecords] = useState<SolutionRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<SolutionRecord | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    repository.list().then(setRecords).catch(() => setError("저장된 기록을 불러오지 못했습니다."));
  }, [repository]);

  async function openDetail(id: string) {
    setError("");
    setFeedback("");
    try {
      const record = await repository.getById(id);
      if (!record) return setError("선택한 풀이를 찾지 못했습니다.");
      setSelectedRecord(record);
    } catch {
      setError("풀이 상세 내용을 불러오지 못했습니다.");
    }
  }

  async function copyCode() {
    if (!selectedRecord) return;
    setError("");
    setFeedback("");
    try {
      await copyText(selectedRecord.code);
      setFeedback("코드가 복사되었습니다");
    } catch {
      setError("코드를 복사하지 못했습니다.");
    }
  }

  return (
    <main className="popup archive-page" aria-labelledby="archive-title">
      <header className="popup-header">
        <div><p className="eyebrow">CodeArchive</p><h1 id="archive-title">전체 풀이</h1></div>
        <strong>{records.length}건</strong>
      </header>

      {error && !selectedRecord && <p className="error list-error" role="alert">{error}</p>}

      <div className="archive-layout">
        <section className="record-section archive-list" aria-label="전체 풀이 목록">
          {records.length === 0 ? <p className="empty-state">아직 저장된 풀이가 없습니다.</p> : (
            <ul className="record-list">{records.map((record) => (
              <li key={record.id}>
                <button className="record-card" type="button" onClick={() => openDetail(record.id)}>
                  <strong>{record.title}</strong>
                  <span>{record.platform} · {record.problemNumber} · {solutionProvenance(record)}</span>
                  <span>{record.language} · {record.solvedAt ?? "날짜 미입력"} · {solutionDisplayTime(record)}</span>
                  {record.performance && <span>실행시간 {record.performance.executionTime} · 메모리 {record.performance.memoryUsage}</span>}
                </button>
              </li>
            ))}</ul>
          )}
        </section>

        <section className="archive-detail" aria-label="풀이 상세">
          {!selectedRecord ? <p className="empty-state">목록에서 풀이를 선택하세요.</p> : (
            <div className="detail-card archive-detail-card">
              <div className="detail-heading"><div><p className="eyebrow">{selectedRecord.platform} · {selectedRecord.problemNumber}</p><h2>{selectedRecord.title}</h2></div></div>
              <dl className="detail-meta">
                <div><dt>저장 방식</dt><dd>{solutionProvenance(selectedRecord)}</dd></div>
                <div><dt>언어</dt><dd>{selectedRecord.language}</dd></div>
                <div><dt>풀이 날짜</dt><dd>{selectedRecord.solvedAt ?? "미입력"}</dd></div>
                <div><dt>표시 시각</dt><dd>{solutionDisplayTime(selectedRecord)}</dd></div>
                <div><dt>수정 시각</dt><dd>{formatKstDateTime(selectedRecord.updatedAt)}</dd></div>
                {selectedRecord.performance && <><div><dt>실행시간</dt><dd>{selectedRecord.performance.executionTime}</dd></div><div><dt>메모리</dt><dd>{selectedRecord.performance.memoryUsage}</dd></div></>}
              </dl>
              <pre className="code-view archive-code"><code>{selectedRecord.code}</code></pre>
              {feedback && <p className="success" role="status">{feedback}</p>}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="detail-actions"><button className="secondary-button" type="button" onClick={copyCode}>코드 복사</button></div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
