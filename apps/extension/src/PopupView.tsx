import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import "./popup.css";
import type { AiUsage, NewSolutionInput, SolutionRecord } from "./solution";
import { indexedDbSolutionRepository, type SolutionRepository } from "./solutionRepository";
import { buildExportFilename, downloadTextFile, toMarkdown } from "./solutionExport";
import { importSourceFile, parseSolutionJson } from "./solutionImport";
import type { DetectedProblemInfo } from "./adapters/platformAdapter";
import type { SweaEditorInfo } from "./adapters/swea/sweaEditor";
import type { SweaSolvingProblemMeta } from "./adapters/swea/sweaSolvingProblemMeta";
import { SweaDetectionPanel } from "./SweaDetectionPanel";
import type { PageContextState } from "./content/pageContextBridge";
import { formatKstDateTime } from "./displayTime";
import { groupSolutions, solutionDisplayTime, solutionProvenance } from "./solutionPresentation";
import { buildCopyText, loadCopySettings, saveCopySettings, type CopySettings } from "./copySettings";
import { RemoteRecordPanel } from "./RemoteRecordPanel";
import { codeArchiveAuthService } from "./authRuntime";
import type { CodeArchiveAuthService } from "./authSession";
import { codeArchiveAiApi, type CodeArchiveAiApi } from "./aiArtifacts";

const RECENT_GROUP_LIMIT = 5;
const EMPTY_FORM: NewSolutionInput = { platform: "", problemNumber: "", title: "", language: "", code: "", solvedAt: null, aiUsage: "unknown" };
const REQUIRED_FIELDS: Array<keyof Pick<NewSolutionInput, "platform" | "problemNumber" | "title" | "language" | "code">> = ["platform", "problemNumber", "title", "language", "code"];
const AI_USAGE_LABELS: Record<AiUsage, string> = { used: "사용함", not_used: "사용 안 함", unknown: "모름" };

interface PopupProps {
  repository?: SolutionRepository;
  requestPageContext?: () => Promise<PageContextState>;
  copyText?: (text: string) => Promise<void>;
  openArchive?: () => void;
  confirmDelete?: (message: string) => boolean;
  authService?: CodeArchiveAuthService;
  aiApi?: CodeArchiveAiApi;
}

type ViewMode = "list" | "create" | "detail" | "edit";

function normalizedForm(form: NewSolutionInput): NewSolutionInput | null {
  const executionTime = form.performance?.executionTime.trim() ?? "";
  const memoryUsage = form.performance?.memoryUsage.trim() ?? "";
  if (Boolean(executionTime) !== Boolean(memoryUsage)) return null;
  return { ...form, performance: executionTime && memoryUsage ? { executionTime, memoryUsage } : undefined };
}

function CopySettingsControls({ settings, onChange }: { settings: CopySettings; onChange(settings: CopySettings): void }) {
  const toggle = (key: keyof CopySettings) => onChange({ ...settings, [key]: !settings[key] });
  return <fieldset className="copy-settings"><legend>코드 복사 설정</legend><label><input type="checkbox" checked={settings.includeProblemInfo} onChange={() => toggle("includeProblemInfo")} /> 문제 정보 주석</label><label><input type="checkbox" checked={settings.includeLanguage} onChange={() => toggle("includeLanguage")} /> 언어 주석</label><label><input type="checkbox" checked={settings.includePerformance} onChange={() => toggle("includePerformance")} /> 실행시간·메모리 주석</label></fieldset>;
}

export function Popup({
  repository = indexedDbSolutionRepository,
  requestPageContext,
  copyText = (text) => navigator.clipboard.writeText(text),
  openArchive = () => window.open(new URL("archive.html", window.location.href).href, "_blank"),
  confirmDelete = (message) => window.confirm(message),
  authService = codeArchiveAuthService,
  aiApi = codeArchiveAiApi,
}: PopupProps) {
  const [form, setForm] = useState<NewSolutionInput>(EMPTY_FORM);
  const [records, setRecords] = useState<SolutionRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<SolutionRecord | null>(null);
  const [mode, setMode] = useState<ViewMode>("list");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [copySettings, setCopySettings] = useState<CopySettings>(() => loadCopySettings());
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);

  useEffect(() => { repository.list().then(setRecords).catch(() => setError("저장된 기록을 불러오지 못했습니다.")); }, [repository]);
  const groups = useMemo(() => groupSolutions(records), [records]);
  const recentGroups = groups.slice(0, RECENT_GROUP_LIMIT);

  function changeCopySettings(settings: CopySettings) { setCopySettings(settings); saveCopySettings(settings); }
  function updateField<K extends keyof NewSolutionInput>(key: K, value: NewSolutionInput[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function updatePerformance(key: "executionTime" | "memoryUsage", value: string) { setForm((current) => ({ ...current, performance: { executionTime: current.performance?.executionTime ?? "", memoryUsage: current.performance?.memoryUsage ?? "", [key]: value } })); }
  function beginCreate() { setForm(EMPTY_FORM); setSelectedRecord(null); setImportedFrom(null); setError(""); setFeedback(""); setMode("create"); }
  function beginDetectedCreate(problem: DetectedProblemInfo) { setForm({ ...EMPTY_FORM, platform: problem.platform, problemNumber: problem.problemNumber, title: problem.title }); setSelectedRecord(null); setImportedFrom("SWEA 현재 페이지"); setError(""); setFeedback(""); setMode("create"); }
  function beginEditorCreate(editor: SweaEditorInfo) { setForm({ ...EMPTY_FORM, platform: "SWEA", language: editor.language ?? "", code: editor.code }); setSelectedRecord(null); setImportedFrom("SWEA 현재 풀이"); setError(""); setFeedback(""); setMode("create"); }
  function beginSolvingCreate(problem: SweaSolvingProblemMeta, editor: SweaEditorInfo) { setForm({ ...EMPTY_FORM, platform: "SWEA", problemNumber: problem.problemNumber, title: problem.title, language: editor.language ?? "", code: editor.code }); setSelectedRecord(null); setImportedFrom("SWEA 현재 풀이"); setError(""); setFeedback(""); setMode("create"); }
  function beginEdit() { if (!selectedRecord) return; setForm({ platform: selectedRecord.platform, problemNumber: selectedRecord.problemNumber, title: selectedRecord.title, language: selectedRecord.language, code: selectedRecord.code, solvedAt: selectedRecord.solvedAt, aiUsage: selectedRecord.aiUsage, performance: selectedRecord.performance }); setError(""); setFeedback(""); setMode("edit"); }
  async function refreshRecords() { setRecords(await repository.list()); }
  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setError(""); setFeedback(""); try { const content = await file.text(); const imported = file.name.toLowerCase().endsWith(".json") ? parseSolutionJson(content, file.name) : importSourceFile(file.name, content); setSelectedRecord(null); setForm(imported.input); setImportedFrom(imported.sourceName); setMode("create"); } catch (importError) { setImportedFrom(null); setError(importError instanceof Error ? importError.message : "파일을 가져오지 못했습니다."); setMode("list"); } }
  async function openDetail(id: string) { setError(""); setFeedback(""); try { const record = await repository.getById(id); if (!record) return setError("선택한 풀이를 찾지 못했습니다."); setSelectedRecord(record); setMode("detail"); } catch { setError("풀이 상세 내용을 불러오지 못했습니다."); } }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (REQUIRED_FIELDS.some((key) => !form[key].trim())) return setError("필수 입력값을 모두 입력해주세요."); const normalized = normalizedForm(form); if (!normalized) return setError("실행시간과 메모리는 둘 다 입력하거나 둘 다 비워주세요."); setSaving(true); setError(""); setFeedback(""); try { if (mode === "edit" && selectedRecord) { const updated = await repository.update(selectedRecord.id, normalized); setSelectedRecord(updated); await refreshRecords(); setMode("detail"); } else { await repository.create(normalized); await refreshRecords(); setForm(EMPTY_FORM); setImportedFrom(null); setMode("list"); } } catch { setError(mode === "edit" ? "풀이를 수정하지 못했습니다." : "풀이를 저장하지 못했습니다."); } finally { setSaving(false); } }
  async function copyCode() { if (!selectedRecord) return; setError(""); setFeedback(""); try { await copyText(buildCopyText(selectedRecord, copySettings)); setFeedback("코드가 복사되었습니다"); } catch { setError("코드를 복사하지 못했습니다."); } }
  function exportRecord(format: "source" | "markdown") { if (!selectedRecord) return; const content = format === "source" ? buildCopyText(selectedRecord, copySettings) : toMarkdown(selectedRecord); downloadTextFile(buildExportFilename(selectedRecord, format), content, format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8"); }
  async function deleteRecord() { if (!selectedRecord || !confirmDelete("이 풀이 기록을 삭제할까요?")) return; setError(""); try { await repository.delete(selectedRecord.id); await refreshRecords(); setSelectedRecord(null); setMode("list"); } catch { setError("풀이 기록을 삭제하지 못했습니다."); } }
  function backToList() { setSelectedRecord(null); setForm(EMPTY_FORM); setImportedFrom(null); setError(""); setFeedback(""); setMode("list"); }
  function toggleGroup(key: string) { setExpandedGroups((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  const showForm = mode === "create" || mode === "edit";

  return <main className="popup" aria-labelledby="popup-title">
    <header className="popup-header"><div><p className="eyebrow">CodeArchive</p><h1 id="popup-title">내 풀이 기록</h1></div>{mode === "list" && <div className="header-actions"><label className="secondary-button import-button">파일 가져오기<input aria-label="파일 가져오기" type="file" accept=".java,.py,.js,.ts,.cpp,.cc,.cxx,.c,.kt,.cs,.go,.rs,.swift,.json,text/*,application/json" onChange={handleImportFile} /></label><button className="primary-button" type="button" onClick={beginCreate}>새 풀이 등록</button></div>}</header>
    {mode === "list" && <SweaDetectionPanel requestContext={requestPageContext} savedRecords={records} onProblemPrefill={beginDetectedCreate} onEditorPrefill={beginEditorCreate} onSolvingPrefill={beginSolvingCreate} />}
    {showForm && <form className="solution-form" onSubmit={handleSubmit} noValidate><div className="form-heading"><strong>{mode === "edit" ? "풀이 수정" : "새 풀이 등록"}</strong><button className="text-button" type="button" onClick={mode === "edit" ? () => setMode("detail") : backToList}>취소</button></div>{mode === "create" && importedFrom && <p className="import-notice">{importedFrom}에서 가져왔습니다. 내용을 확인한 뒤 저장해주세요.</p>}<div className="field-grid"><label>플랫폼 <span>*</span><input value={form.platform} onChange={(e) => updateField("platform", e.target.value)} /></label><label>문제 번호 <span>*</span><input value={form.problemNumber} onChange={(e) => updateField("problemNumber", e.target.value)} /></label></div><label>제목 <span>*</span><input value={form.title} onChange={(e) => updateField("title", e.target.value)} /></label><label>언어 <span>*</span><input value={form.language} onChange={(e) => updateField("language", e.target.value)} /></label><label>코드 <span>*</span><textarea rows={10} value={form.code} onChange={(e) => updateField("code", e.target.value)} /></label><div className="field-grid"><label>풀이 날짜<input type="date" value={form.solvedAt ?? ""} onChange={(e) => updateField("solvedAt", e.target.value || null)} /></label><label>AI 활용<select value={form.aiUsage} onChange={(e) => updateField("aiUsage", e.target.value as AiUsage)}><option value="unknown">모름</option><option value="not_used">사용 안 함</option><option value="used">사용함</option></select></label></div><div className="field-grid"><label>실행시간<input placeholder="123 ms" value={form.performance?.executionTime ?? ""} onChange={(e) => updatePerformance("executionTime", e.target.value)} /></label><label>메모리<input placeholder="45,678 kb" value={form.performance?.memoryUsage ?? ""} onChange={(e) => updatePerformance("memoryUsage", e.target.value)} /></label></div><p className="form-hint">실행시간과 메모리는 둘 다 입력하거나 둘 다 비워주세요.</p>{error && <p className="error" role="alert">{error}</p>}<button className="primary-button save-button" type="submit" disabled={saving}>{saving ? "저장 중..." : mode === "edit" ? "수정 저장" : "저장"}</button></form>}
    {mode === "detail" && selectedRecord && <section className="detail-card" aria-labelledby="detail-title"><div className="detail-heading"><div><p className="eyebrow">{selectedRecord.platform} · {selectedRecord.problemNumber}</p><h2 id="detail-title">{selectedRecord.title}</h2></div><button className="text-button" type="button" onClick={backToList}>목록으로</button></div><dl className="detail-meta"><div><dt>저장 방식</dt><dd>{solutionProvenance(selectedRecord)}</dd></div><div><dt>언어</dt><dd>{selectedRecord.language}</dd></div><div><dt>풀이 날짜</dt><dd>{selectedRecord.solvedAt ?? "미입력"}</dd></div><div><dt>AI 활용</dt><dd>{AI_USAGE_LABELS[selectedRecord.aiUsage]}</dd></div>{selectedRecord.performance && <><div><dt>실행시간</dt><dd>{selectedRecord.performance.executionTime}</dd></div><div><dt>메모리</dt><dd>{selectedRecord.performance.memoryUsage}</dd></div></>}<div><dt>수정 시각</dt><dd>{formatKstDateTime(selectedRecord.updatedAt)}</dd></div></dl><CopySettingsControls settings={copySettings} onChange={changeCopySettings} /><pre className="code-view"><code>{selectedRecord.code}</code></pre><RemoteRecordPanel record={selectedRecord} repository={repository} authService={authService} aiApi={aiApi} onRecordChange={(updated) => { setSelectedRecord(updated); void refreshRecords(); }} />{feedback && <p className="success" role="status">{feedback}</p>}{error && <p className="error" role="alert">{error}</p>}<div className="detail-actions"><button className="primary-button" type="button" onClick={beginEdit}>수정</button><button className="secondary-button" type="button" onClick={copyCode}>코드 복사</button><div className="export-actions"><button type="button" onClick={() => exportRecord("source")}>Source</button><button type="button" onClick={() => exportRecord("markdown")}>Markdown</button><button className="danger-button" type="button" onClick={deleteRecord}>삭제</button></div></div></section>}
    {mode === "list" && error && <p className="error list-error" role="alert">{error}</p>}
    {mode === "list" && <section className="record-section" aria-labelledby="record-list-title"><div className="section-heading"><h2 id="record-list-title">저장된 풀이 {records.length}건 · {groups.length}문제</h2><button className="text-button" type="button" onClick={openArchive}>전체 풀이 보기</button></div>{recentGroups.length === 0 ? <p className="empty-state">아직 저장된 풀이가 없습니다.</p> : <ul className="record-list group-list">{recentGroups.map((group) => <li key={group.key} className="record-group"><button className="record-card group-card" type="button" aria-expanded={expandedGroups.has(group.key)} onClick={() => toggleGroup(group.key)}><strong>{group.representative.title}</strong><span>{group.representative.platform} · {group.representative.problemNumber} · {group.records.length}회</span><span>수정 시각 · {solutionDisplayTime(group.representative)}</span></button>{expandedGroups.has(group.key) && <ul className="submission-list">{group.records.map((record) => <li key={record.id}><button type="button" className="submission-card" onClick={() => openDetail(record.id)}><span>{solutionProvenance(record)} · {record.language}</span><span>{solutionDisplayTime(record)}</span></button></li>)}</ul>}</li>)}</ul>}</section>}
    <p className="status" role="status">IndexedDB 로컬 저장 우선</p>
  </main>;
}
