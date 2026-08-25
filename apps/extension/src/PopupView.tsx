import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import "./popup.css";
import type { AiUsage, NewSolutionInput, SolutionRecord } from "./solution";
import { indexedDbSolutionRepository, type SolutionRepository } from "./solutionRepository";
import { buildExportFilename, downloadTextFile, toJson, toMarkdown, toSource, type ExportFormat } from "./solutionExport";
import { importSourceFile, parseSolutionJson } from "./solutionImport";
import type { DetectedProblemInfo } from "./adapters/platformAdapter";
import type { SweaEditorInfo } from "./adapters/swea/sweaEditor";
import type { SweaSolvingProblemMeta } from "./adapters/swea/sweaSolvingProblemMeta";
import { SweaDetectionPanel } from "./SweaDetectionPanel";
import type { PageContextState } from "./content/pageContextBridge";

const POPUP_VERSION = "v0.3.9";
const EMPTY_FORM: NewSolutionInput = { platform: "", problemNumber: "", title: "", language: "", code: "", solvedAt: null, aiUsage: "unknown" };
const REQUIRED_FIELDS: Array<keyof Pick<NewSolutionInput, "platform" | "problemNumber" | "title" | "language" | "code">> = ["platform", "problemNumber", "title", "language", "code"];
const AI_USAGE_LABELS: Record<AiUsage, string> = { used: "사용함", not_used: "사용 안 함", unknown: "모름" };
interface PopupProps {
  repository?: SolutionRepository;
  requestPageContext?: () => Promise<PageContextState>;
}
type ViewMode = "list" | "create" | "detail" | "edit";

export function Popup({ repository = indexedDbSolutionRepository, requestPageContext }: PopupProps) {
  const [form, setForm] = useState<NewSolutionInput>(EMPTY_FORM);
  const [records, setRecords] = useState<SolutionRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<SolutionRecord | null>(null);
  const [mode, setMode] = useState<ViewMode>("list");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);

  useEffect(() => { repository.list().then(setRecords).catch(() => setError("저장된 기록을 불러오지 못했습니다.")); }, [repository]);
  function updateField<K extends keyof NewSolutionInput>(key: K, value: NewSolutionInput[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function beginCreate() { setForm(EMPTY_FORM); setSelectedRecord(null); setImportedFrom(null); setError(""); setMode("create"); }
  function beginDetectedCreate(problem: DetectedProblemInfo) {
    setForm({ ...EMPTY_FORM, platform: problem.platform, problemNumber: problem.problemNumber, title: problem.title });
    setSelectedRecord(null); setImportedFrom("SWEA 현재 페이지"); setError(""); setMode("create");
  }
  function beginEditorCreate(editor: SweaEditorInfo) {
    setForm({ ...EMPTY_FORM, platform: "SWEA", language: editor.language ?? "", code: editor.code });
    setSelectedRecord(null); setImportedFrom("SWEA 현재 풀이"); setError(""); setMode("create");
  }
  function beginSolvingCreate(problem: SweaSolvingProblemMeta, editor: SweaEditorInfo) {
    setForm({ ...EMPTY_FORM, platform: "SWEA", problemNumber: problem.problemNumber, title: problem.title, language: editor.language ?? "", code: editor.code });
    setSelectedRecord(null); setImportedFrom("SWEA 현재 풀이"); setError(""); setMode("create");
  }
  function beginEdit() {
    if (!selectedRecord) return;
    setForm({ platform: selectedRecord.platform, problemNumber: selectedRecord.problemNumber, title: selectedRecord.title, language: selectedRecord.language, code: selectedRecord.code, solvedAt: selectedRecord.solvedAt, aiUsage: selectedRecord.aiUsage });
    setImportedFrom(null); setError(""); setMode("edit");
  }
  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setError("");
    try {
      const content = await file.text();
      const imported = file.name.toLowerCase().endsWith(".json") ? parseSolutionJson(content, file.name) : importSourceFile(file.name, content);
      setSelectedRecord(null); setForm(imported.input); setImportedFrom(imported.sourceName); setMode("create");
    } catch (importError) { setImportedFrom(null); setError(importError instanceof Error ? importError.message : "파일을 가져오지 못했습니다."); setMode("list"); }
  }
  async function openDetail(id: string) {
    setError("");
    try { const record = await repository.getById(id); if (!record) return setError("선택한 풀이를 찾지 못했습니다."); setSelectedRecord(record); setMode("detail"); }
    catch { setError("풀이 상세 내용을 불러오지 못했습니다."); }
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (REQUIRED_FIELDS.some((key) => !form[key].trim())) { setError("필수 입력값을 모두 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      if (mode === "edit" && selectedRecord) { const updated = await repository.update(selectedRecord.id, form); setSelectedRecord(updated); setRecords(await repository.list()); setMode("detail"); }
      else { await repository.create(form); setRecords(await repository.list()); setForm(EMPTY_FORM); setImportedFrom(null); setMode("list"); }
    } catch { setError(mode === "edit" ? "풀이를 수정하지 못했습니다." : "풀이를 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }
  function exportRecord(format: ExportFormat) {
    if (!selectedRecord) return;
    const content = format === "source" ? toSource(selectedRecord) : format === "markdown" ? toMarkdown(selectedRecord) : toJson(selectedRecord);
    const mimeType = format === "json" ? "application/json;charset=utf-8" : format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
    downloadTextFile(buildExportFilename(selectedRecord, format), content, mimeType);
  }
  function backToList() { setSelectedRecord(null); setForm(EMPTY_FORM); setImportedFrom(null); setError(""); setMode("list"); }
  const showForm = mode === "create" || mode === "edit";

  return (
    <main className="popup" aria-labelledby="popup-title">
      <header className="popup-header">
        <div><p className="eyebrow">CodeArchive · {POPUP_VERSION}</p><h1 id="popup-title">내 풀이 기록</h1></div>
        {mode === "list" && <div className="header-actions"><label className="secondary-button import-button">파일 가져오기<input aria-label="파일 가져오기" type="file" accept=".java,.py,.js,.ts,.cpp,.cc,.cxx,.c,.kt,.cs,.go,.rs,.swift,.json,text/*,application/json" onChange={handleImportFile} /></label><button className="primary-button" type="button" onClick={beginCreate}>새 풀이 등록</button></div>}
      </header>

      {mode === "list" && <SweaDetectionPanel requestContext={requestPageContext} onProblemPrefill={beginDetectedCreate} onEditorPrefill={beginEditorCreate} onSolvingPrefill={beginSolvingCreate} />}

      {showForm && (
        <form className="solution-form" onSubmit={handleSubmit} noValidate>
          <div className="form-heading"><strong>{mode === "edit" ? "풀이 수정" : "새 풀이 등록"}</strong><button className="text-button" type="button" onClick={mode === "edit" ? () => setMode("detail") : backToList}>취소</button></div>
          {mode === "create" && importedFrom && <p className="import-notice">{importedFrom}에서 가져왔습니다. 내용을 확인한 뒤 저장해주세요.</p>}
          <div className="field-grid"><label>플랫폼 <span aria-hidden="true">*</span><input value={form.platform} onChange={(e) => updateField("platform", e.target.value)} /></label><label>문제 번호 <span aria-hidden="true">*</span><input value={form.problemNumber} onChange={(e) => updateField("problemNumber", e.target.value)} /></label></div>
          <label>제목 <span aria-hidden="true">*</span><input value={form.title} onChange={(e) => updateField("title", e.target.value)} /></label>
          <label>언어 <span aria-hidden="true">*</span><input value={form.language} onChange={(e) => updateField("language", e.target.value)} /></label>
          <label>코드 <span aria-hidden="true">*</span><textarea rows={10} value={form.code} onChange={(e) => updateField("code", e.target.value)} /></label>
          <div className="field-grid"><label>풀이 날짜<input type="date" value={form.solvedAt ?? ""} onChange={(e) => updateField("solvedAt", e.target.value || null)} /></label><label>AI 활용<select value={form.aiUsage} onChange={(e) => updateField("aiUsage", e.target.value as AiUsage)}><option value="unknown">모름</option><option value="not_used">사용 안 함</option><option value="used">사용함</option></select></label></div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary-button save-button" type="submit" disabled={saving}>{saving ? "저장 중..." : mode === "edit" ? "수정 저장" : "저장"}</button>
        </form>
      )}

      {mode === "detail" && selectedRecord && <section className="detail-card" aria-labelledby="detail-title"><div className="detail-heading"><div><p className="eyebrow">{selectedRecord.platform} · {selectedRecord.problemNumber}</p><h2 id="detail-title">{selectedRecord.title}</h2></div><button className="text-button" type="button" onClick={backToList}>목록으로</button></div><dl className="detail-meta"><div><dt>언어</dt><dd>{selectedRecord.language}</dd></div><div><dt>풀이 날짜</dt><dd>{selectedRecord.solvedAt ?? "미입력"}</dd></div><div><dt>AI 활용</dt><dd>{AI_USAGE_LABELS[selectedRecord.aiUsage]}</dd></div>{selectedRecord.performance && <><div><dt>실행시간</dt><dd>{selectedRecord.performance.executionTime}</dd></div><div><dt>메모리</dt><dd>{selectedRecord.performance.memoryUsage}</dd></div></>}<div><dt>수정 시각</dt><dd>{selectedRecord.updatedAt}</dd></div></dl><pre className="code-view"><code>{selectedRecord.code}</code></pre>{error && <p className="error" role="alert">{error}</p>}<div className="detail-actions"><button className="primary-button" type="button" onClick={beginEdit}>수정</button><div className="export-actions" aria-label="내보내기"><button type="button" onClick={() => exportRecord("source")}>Source</button><button type="button" onClick={() => exportRecord("markdown")}>Markdown</button><button type="button" onClick={() => exportRecord("json")}>JSON</button></div></div></section>}
      {mode === "list" && error && <p className="error list-error" role="alert">{error}</p>}
      {mode === "list" && <section className="record-section" aria-labelledby="record-list-title"><div className="section-heading"><h2 id="record-list-title">저장된 풀이</h2><span>{records.length}건</span></div>{records.length === 0 ? <p className="empty-state">아직 저장된 풀이가 없습니다.</p> : <ul className="record-list">{records.map((record) => <li key={record.id}><button className="record-card" type="button" onClick={() => openDetail(record.id)}><strong>{record.title}</strong><span>{record.platform} · {record.problemNumber}</span><span>{record.language}{record.solvedAt ? ` · ${record.solvedAt}` : ""}</span></button></li>)}</ul>}</section>}
      <p className="status" role="status">서버 연결 없음 · IndexedDB 로컬 저장</p>
    </main>
  );
}
