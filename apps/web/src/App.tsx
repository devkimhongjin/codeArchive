import { useEffect, useMemo, useState } from "react";
import { bootstrapArchiveDataSource } from "./archiveDataSource";
import {
  groupDashboardSolutions,
  type DashboardArchiveDataSource,
  type DashboardSolution,
} from "./archiveTypes";
import "./styles.css";

interface AppProps {
  dataSource?: DashboardArchiveDataSource;
}

function formatDate(value: string | null): string {
  return value ?? "미입력";
}

function sourceLabel(source: DashboardSolution["source"]): string {
  return source === "captured" ? "자동 수집" : "수동 기록";
}

export function App({ dataSource = bootstrapArchiveDataSource }: AppProps) {
  const [records, setRecords] = useState<readonly DashboardSolution[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    dataSource
      .listSolutions()
      .then((next) => {
        if (!active) return;
        setRecords(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch(() => {
        if (active) setError("풀이 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataSource]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((record) =>
      [record.platform, record.problemNumber, record.title, record.language]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, records]);

  const groups = useMemo(() => groupDashboardSolutions(filtered), [filtered]);
  const selected = records.find((record) => record.id === selectedId) ?? null;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CodeArchive</p>
          <h1>전체 풀이</h1>
          <p className="subtitle">가볍게 탐색하는 풀이 아카이브</p>
        </div>
        <div className="status-strip" aria-label="향후 연결 상태">
          <span>로그인 필요</span>
          <span>Extension 연결 안 됨</span>
          <span>동기화 준비 중</span>
        </div>
      </header>

      <section className="toolbar" aria-label="풀이 검색">
        <label>
          <span>검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="문제 번호, 제목, 언어"
          />
        </label>
        <strong>{filtered.length}건 · {groups.length}문제</strong>
      </section>

      {loading ? (
        <p className="state-card" role="status">풀이 목록을 불러오는 중입니다.</p>
      ) : error ? (
        <p className="state-card error" role="alert">{error}</p>
      ) : records.length === 0 ? (
        <p className="state-card">아직 표시할 풀이가 없습니다.</p>
      ) : (
        <div className="archive-layout">
          <section className="archive-list" aria-label="전체 풀이 목록">
            {groups.length === 0 ? (
              <p className="state-card">검색 결과가 없습니다.</p>
            ) : (
              groups.map((group) => (
                <article className="problem-group" key={group.key}>
                  <div className="problem-heading">
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.platform} · {group.problemNumber}</span>
                    </div>
                    <small>{group.records.length}회</small>
                  </div>
                  <div className="submission-list">
                    {group.records.map((record) => (
                      <button
                        type="button"
                        key={record.id}
                        className={record.id === selectedId ? "submission selected" : "submission"}
                        onClick={() => setSelectedId(record.id)}
                      >
                        <span>{sourceLabel(record.source)} · {record.language}</span>
                        <small>{formatDate(record.solvedAt)}</small>
                      </button>
                    ))}
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="detail-panel" aria-label="풀이 상세">
            {!selected ? (
              <p className="state-card">목록에서 풀이를 선택하세요.</p>
            ) : (
              <article className="detail-card">
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">{selected.platform} · {selected.problemNumber}</p>
                    <h2>{selected.title}</h2>
                  </div>
                  <span className="badge">{sourceLabel(selected.source)}</span>
                </div>
                <dl className="metadata">
                  <div><dt>언어</dt><dd>{selected.language}</dd></div>
                  <div><dt>풀이 날짜</dt><dd>{formatDate(selected.solvedAt)}</dd></div>
                  <div><dt>실행시간</dt><dd>{selected.executionTime ?? "미입력"}</dd></div>
                  <div><dt>메모리</dt><dd>{selected.memoryUsage ?? "미입력"}</dd></div>
                </dl>
                <pre className="code-view"><code>{selected.code}</code></pre>
                <p className="future-note">이 상세 화면은 다음 bounded slice에서 인증된 Main API 데이터와 연결할 수 있습니다.</p>
              </article>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
