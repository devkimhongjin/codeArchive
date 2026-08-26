import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./popup.css";
import type { AiUsage, NewSolutionInput, SolutionRecord } from "./solution";
import { indexedDbSolutionRepository, type SolutionRepository } from "./solutionRepository";
import { formatKstDateTime } from "./displayTime";
import { groupSolutions, solutionDisplayTime, solutionProvenance } from "./solutionPresentation";
import { buildCopyText, loadCopySettings, saveCopySettings, type CopySettings } from "./copySettings";
import { buildExportFilename, downloadTextFile, toMarkdown } from "./solutionExport";

interface ArchiveProps {
  repository?: SolutionRepository;
  copyText?: (text: string) => Promise<void>;
  confirmDelete?: (message: string) => boolean;
}

function normalizedForm(form: NewSolutionInput): NewSolutionInput | null {
  const executionTime = form.performance?.executionTime.trim() ?? "";
  const memoryUsage = form.performance?.memoryUsage.trim() ?? "";
  if (Boolean(executionTime) !== Boolean(memoryUsage)) return null;
  return { ...form, performance: executionTime && memoryUsage ? { executionTime, memoryUsage } : undefined };
}

export function Archive({ repository = indexedDbSolutionRepository, copyText = (text) => navigator.clipboard.writeText(text), confirmDelete = (message) => window.confirm(message) }: ArchiveProps) {
  const [records, setRecords] = useState<SolutionRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<SolutionRecord | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<NewSolutionInput | null>(null);
  const [copySettings, setCopySettings] = useState<CopySettings>(() => loadCopySettings());
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const groups = useMemo(() => groupSolutions(records), [records]);

  useEffect(() => { repository.list().then(setRecords).catch(() => setError("저장된 기록을 불러오지 못했습니다.")); }, [repository]);
  async function refresh() { setRecords(await repository.list()); }
  async function openDetail(id: string) { setError(""); setFeedback(""); setEditing(false); try { const record = await repository.getById(id); if (!record) return setError("선택한 풀이를 찾지 못했습니다."); setSelectedRecord(record); } catch { setError("풀이 상세 내용을 불러오지 못했습니다."); } }
  function beginEdit() { if (!selectedRecord) return; setForm({ platform: selectedRecord.platform, problemNumber: selectedRecord.problemNumber, title: selectedRecord.title, language: selectedRecord.language, code: selectedRecord.code, solvedAt: selectedRecord.solvedAt, aiUsage: selectedRecord.aiUsage, performance: selectedRecord.performance }); setError(""); setFeedback(""); setEditing(true); }
  function updateForm<K extends keyof NewSolutionInput>(key: K, value: NewSolutionInput[K]) { setForm((current) => current ? { ...current, [key]: value } : current); }
  function updatePerformance(key: "executionTime" | "memoryUsage", value: string) { setForm((current) => current ? { ...current, performance: { executionTime: current.performance?.executionTime ?? "", memoryUsage: current.performance?.memoryUsage ?? "", [key]: value } } : current); }
  async function saveEdit(event: FormEvent) { event.preventDefault(); if (!selectedRecord || !form) return; if ([form.platform, form.problemNumber, form.title, form.language, form.code].some((value) => !value.trim())) return setError("필수 입력값을 모두 입력해주세요."); const normalized = normalizedForm(form); if (!normalized) return setError("실행시간과 메모리는 둘 다 입력하거나 둘 다 비워주세요."); try { const updated = await repository.update(selectedRecord.id, normalized); setSelectedRecord(updated); setEditing(false); await refresh(); } catch { setError("풀이를 수정하지 못했습니다."); } }
  async function copyCode() { if (!selectedRecord) return; setError(""); setFeedback(""); try { await copyText(buildCopyText(selectedRecord, copySettings)); setFeedback("코드가 복사되었습니다"); } catch { setError("코드를 복사하지 못했습니다."); } }
  function changeCopySettings(key: keyof CopySettings) { const next = { ...copySettings, [key]: !copySettings[key] }; setCopySettings(next); saveCopySettings(next); }
  function exportRecord(format: "source" | "markdown") { if (!selectedRecord) return; const content = format === "source" ? buildCopyText(selectedRecord, copySettings) : toMarkdown(selectedRecord); downloadTextFile(buildExportFilename(selectedRecord, format), content, format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8"); }
  async function deleteRecord() { if (!selectedRecord || !confirmDelete("이 풀이 기록을 삭제할까요?")) return; try { await repository.delete(selectedRecord.id); setSelectedRecord(null); setEditing(false); await refresh(); } catch { setError("풀이 기록을 삭제하지 못했습니다."); } }
  function toggleGroup(key: string) { setExpandedGroups((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }

  return <main className="popup archive-page" aria-labelledby="archive-title">
    <header className="popup-header"><div><p className="eyebrow">CodeArchive</p><h1 id="archive-title">전체 풀이</h1></div><strong>{records.length}건 · {groups.length}문제</strong></header>
    {error && !selectedRecord && <p className="error list-error" role="alert">{error}</p>}
    <div className="archive-layout">
      <section className="record-section archive-list" aria-label="전체 풀이 목록">{groups.length === 0 ? <p className="empty-state">아직 저장된 풀이가 없습니다.</p> : <ul className="record-list group-list">{groups.map((group) => <li key={group.key} className="record-group"><button className="record-card group-card" type="button" aria-expanded={expandedGroups.has(group.key)} onClick={() => toggleGroup(group.key)}><strong>{group.representative.title}</strong><span>{group.representative.platform} · {group.representative.problemNumber} · {group.records.length}회</span><span>수정 시각 · {solutionDisplayTime(group.representative)}</span></button>{expandedGroups.has(group.key) && <ul className="submission-list">{group.records.map((record) => <li key={record.id}><button className="submission-card" type="button" onClick={() => openDetail(record.id)}><span>{solutionProvenance(record)} · {record.language}</span><span>{solutionDisplayTime(record)}</span></button></li>)}</ul>}</li>)}</ul>}</section>
      <section className="archive-detail" aria-label="풀이 상세">{!selectedRecord ? <p className="empty-state">목록에서 문제를 펼쳐 제출 기록을 선택하세요.</p> : editing && form ? <form className="solution-form archive-edit" onSubmit={saveEdit}><div className="form-heading"><strong>풀이 수정</strong><button className="text-button" type="button" onClick={() => setEditing(false)}>취소</button></div><div className="field-grid"><label>플랫폼 <input value={form.platform} onChange={(e) => updateForm("platform", e.target.value)} /></label><label>문제 번호 <input value={form.problemNumber} onChange={(e) => updateForm("problemNumber", e.target.value)} /></label></div><label>제목 <input value={form.title} onChange={(e) => updateForm("title", e.target.value)} /></label><label>언어 <input value={form.language} onChange={(e) => updateForm("language", e.target.value)} /></label><label>코드 <textarea rows={12} value={form.code} onChange={(e) => updateForm("code", e.target.value)} /></label><div className="field-grid"><label>풀이 날짜<input type="date" value={form.solvedAt ?? ""} onChange={(e) => updateForm("solvedAt", e.target.value || null)} /></label><label>AI 활용<select value={form.aiUsage} onChange={(e) => updateForm("aiUsage", e.target.value as AiUsage)}><option value="unknown">모름</option><option value="not_used">사용 안 함</option><option value="used">사용함</option></select></label></div><div className="field-grid"><label>실행시간<input value={form.performance?.executionTime ?? ""} onChange={(e) => updatePerformance("executionTime", e.target.value)} /></label><label>메모리<input value={form.performance?.memoryUsage ?? ""} onChange={(e) => updatePerformance("memoryUsage", e.target.value)} /></label></div>{error && <p className="error" role="alert">{error}</p>}<button className="primary-button save-button" type="submit">수정 저장</button></form> : <div className="detail-card archive-detail-card"><div className="detail-heading"><div><p className="eyebrow">{selectedRecord.platform} · {selectedRecord.problemNumber}</p><h2>{selectedRecord.title}</h2></div></div><dl className="detail-meta"><div><dt>저장 방식</dt><dd>{solutionProvenance(selectedRecord)}</dd></div><div><dt>언어</dt><dd>{selectedRecord.language}</dd></div><div><dt>풀이 날짜</dt><dd>{selectedRecord.solvedAt ?? "미입력"}</dd></div><div><dt>수정 시각</dt><dd>{formatKstDateTime(selectedRecord.updatedAt)}</dd></div>{selectedRecord.performance && <><div><dt>실행시간</dt><dd>{selectedRecord.performance.executionTime}</dd></div><div><dt>메모리</dt><dd>{selectedRecord.performance.memoryUsage}</dd></div></>}</dl><fieldset className="copy-settings"><legend>코드 복사 설정</legend><label><input type="checkbox" checked={copySettings.includeProblemInfo} onChange={() => changeCopySettings("includeProblemInfo")} /> 문제 정보 주석</label><label><input type="checkbox" checked={copySettings.includeLanguage} onChange={() => changeCopySettings("includeLanguage")} /> 언어 주석</label><label><input type="checkbox" checked={copySettings.includePerformance} onChange={() => changeCopySettings("includePerformance")} /> 실행시간·메모리 주석</label></fieldset><pre className="code-view archive-code"><code>{selectedRecord.code}</code></pre>{feedback && <p className="success" role="status">{feedback}</p>}{error && <p className="error" role="alert">{error}</p>}<div className="detail-actions"><button className="primary-button" type="button" onClick={beginEdit}>수정</button><button className="secondary-button" type="button" onClick={copyCode}>코드 복사</button><div className="export-actions"><button type="button" onClick={() => exportRecord("source")}>Source</button><button type="button" onClick={() => exportRecord("markdown")}>Markdown</button><button className="danger-button" type="button" onClick={deleteRecord}>삭제</button></div></div></div>}</section>
    </div>
  </main>;
}
