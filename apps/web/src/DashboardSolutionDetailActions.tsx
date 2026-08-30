import { useLayoutEffect, useState, type FormEvent } from "react";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { SolutionDeleteAction } from "./SolutionDeleteAction";
import { SolutionAiArtifacts } from "./SolutionAiArtifacts";
import { mainApiAiArtifactClient, type DashboardAiArtifactClient } from "./aiArtifactClient";
import { mainApiSolutionDeleteClient, type DashboardSolutionDeleteClient } from "./solutionDeleteClient";
import {
  isDashboardServerSolution,
  type DashboardSolution,
} from "./archiveTypes";
import {
  buildDashboardCopyText,
  buildDashboardExportFilename,
  downloadDashboardText,
  loadDashboardCopySettings,
  saveDashboardCopySettings,
  toDashboardMarkdown,
  type DashboardCopySettings,
} from "./solutionDetailActions";
import {
  mainApiSolutionUpdateClient,
  type DashboardSolutionEditInput,
  type DashboardSolutionUpdateClient,
} from "./solutionUpdateClient";

interface SolutionDetailActionsProps {
  solution: DashboardSolution;
  copyText?: (text: string) => Promise<void>;
  downloadText?: (filename: string, content: string, mimeType?: string) => void;
  updateClient?: DashboardSolutionUpdateClient;
  onSolutionUpdated?: (solution: DashboardSolution) => void;
  onSessionExpired?: () => void;
  deleteClient?: DashboardSolutionDeleteClient;
  onSolutionDeleted?: (id: string) => void;
  aiClient?: DashboardAiArtifactClient;
}

export function SolutionDetailActions({
  solution,
  copyText = (text) => navigator.clipboard.writeText(text),
  downloadText = downloadDashboardText,
  updateClient = mainApiSolutionUpdateClient,
  onSolutionUpdated = () => undefined,
  onSessionExpired = () => undefined,
  deleteClient = mainApiSolutionDeleteClient,
  onSolutionDeleted = () => undefined,
  aiClient = mainApiAiArtifactClient,
}: SolutionDetailActionsProps) {
  const [settings, setSettings] = useState<DashboardCopySettings>(() => loadDashboardCopySettings());
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<DashboardSolutionEditInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Reset before the controls become interactive, never after a user's first click.
  useLayoutEffect(() => {
    setEditing(false);
    setEditForm(null);
    setFeedback("");
    setError("");
  }, [solution.id]);

  function changeSetting(key: keyof DashboardCopySettings) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    saveDashboardCopySettings(next);
  }

  async function copyCode() {
    setFeedback("");
    setError("");
    try {
      await copyText(buildDashboardCopyText(solution, settings));
      setFeedback("코드가 복사되었습니다.");
    } catch {
      setError("코드를 복사하지 못했습니다.");
    }
  }

  function download(format: "source" | "markdown") {
    setFeedback("");
    setError("");
    try {
      const filename = buildDashboardExportFilename(solution, format);
      const content = format === "source"
        ? buildDashboardCopyText(solution, settings)
        : toDashboardMarkdown(solution);
      downloadText(
        filename,
        content,
        format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
      );
      setFeedback(format === "markdown" ? "Markdown 파일을 준비했습니다." : "Source 파일을 준비했습니다.");
    } catch {
      setError("파일을 준비하지 못했습니다.");
    }
  }

  function beginEdit() {
    if (!isDashboardServerSolution(solution)) return;
    setFeedback("");
    setError("");
    setEditForm({
      platform: solution.platform,
      problemNumber: solution.problemNumber,
      title: solution.title,
      language: solution.language,
      code: solution.code,
      executionTime: solution.executionTime ?? "",
      memoryUsage: solution.memoryUsage ?? "",
      aiUsage: solution.aiUsage,
    });
    setEditing(true);
  }

  function changeEditField<K extends keyof DashboardSolutionEditInput>(
    key: K,
    value: DashboardSolutionEditInput[K],
  ) {
    setEditForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm || !isDashboardServerSolution(solution)) return;
    if (
      !editForm.platform.trim()
      || !editForm.problemNumber.trim()
      || !editForm.title.trim()
      || !editForm.language.trim()
      || !editForm.code.trim()
    ) {
      setError("필수 입력값을 모두 입력해주세요.");
      return;
    }

    const original = solution;
    const input = editForm;
    setSaving(true);
    setFeedback("");
    setError("");
    try {
      const updated = await updateClient.updateSolution(original, input);
      onSolutionUpdated(updated);
      setEditing(false);
      setEditForm(null);
      setFeedback("풀이가 수정되었습니다.");
    } catch (cause) {
      if (cause instanceof ArchiveSessionExpiredError) {
        onSessionExpired();
      } else {
        setError("풀이를 수정하지 못했습니다.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="solution-tools" aria-label="풀이 도구">
      <div className="solution-tool-heading">
        <strong>풀이 도구</strong>
        <span>현재 선택한 서버 풀이에만 적용됩니다.</span>
      </div>
      <div className="solution-tool-actions">
        {isDashboardServerSolution(solution) && (
          <button type="button" disabled={saving || deleting || generating} onClick={beginEdit}>수정</button>
        )}
        <button className="primary-button" type="button" onClick={() => void copyCode()}>코드 복사</button>
        <button type="button" onClick={() => download("source")}>Source 다운로드</button>
        <button type="button" onClick={() => download("markdown")}>Markdown 다운로드</button>
      </div>
      {isDashboardServerSolution(solution) && (
        <SolutionDeleteAction
          key={solution.id}
          solution={solution}
          client={deleteClient}
          disabled={editing || saving || generating}
          onDeleted={onSolutionDeleted}
          onSessionExpired={onSessionExpired}
          onPendingChange={setDeleting}
        />
      )}
      {editing && editForm && (
        <form className="solution-edit-form" onSubmit={(event) => void saveEdit(event)}>
          <div className="solution-edit-heading">
            <strong>서버 풀이 수정</strong>
            <button type="button" onClick={() => { setEditing(false); setEditForm(null); setError(""); }}>취소</button>
          </div>
          <div className="solution-edit-grid">
            <label>플랫폼 <span>*</span><input value={editForm.platform} onChange={(event) => changeEditField("platform", event.target.value)} /></label>
            <label>문제 번호 <span>*</span><input value={editForm.problemNumber} onChange={(event) => changeEditField("problemNumber", event.target.value)} /></label>
          </div>
          <label>제목 <span>*</span><input value={editForm.title} onChange={(event) => changeEditField("title", event.target.value)} /></label>
          <label>언어 <span>*</span><input value={editForm.language} onChange={(event) => changeEditField("language", event.target.value)} /></label>
          <label>코드 <span>*</span><textarea rows={12} value={editForm.code} onChange={(event) => changeEditField("code", event.target.value)} /></label>
          <div className="solution-edit-grid">
            <label>실행시간<input value={editForm.executionTime} onChange={(event) => changeEditField("executionTime", event.target.value)} /></label>
            <label>메모리<input value={editForm.memoryUsage} onChange={(event) => changeEditField("memoryUsage", event.target.value)} /></label>
          </div>
          <label>AI 활용<select value={editForm.aiUsage ?? ""} onChange={(event) => changeEditField("aiUsage", event.target.value === "" ? null : event.target.value as DashboardSolutionEditInput["aiUsage"])}><option value="">미입력</option><option value="unknown">모름</option><option value="not_used">사용 안 함</option><option value="used">사용함</option></select></label>
          <p className="solution-edit-hint">제출 결과와 풀이·관찰 시각은 기존 서버 기록의 의미를 그대로 보존합니다.</p>
          <button className="primary-button solution-edit-save" type="submit" disabled={saving}>{saving ? "저장 중..." : "수정 저장"}</button>
        </form>
      )}
      <fieldset className="copy-settings">
        <legend>복사·Source 형식</legend>
        <label><input type="checkbox" checked={settings.includeProblemInfo} onChange={() => changeSetting("includeProblemInfo")} /> 문제 정보 주석</label>
        <label><input type="checkbox" checked={settings.includeLanguage} onChange={() => changeSetting("includeLanguage")} /> 언어 주석</label>
        <label><input type="checkbox" checked={settings.includePerformance} onChange={() => changeSetting("includePerformance")} /> 실행시간·메모리 주석</label>
      </fieldset>
      {feedback && <p className="tool-feedback" role="status">{feedback}</p>}
      {error && <p className="tool-error" role="alert">{error}</p>}
      {isDashboardServerSolution(solution) && <SolutionAiArtifacts
        key={`${solution.id}:${solution.updatedAt}`}
        solution={solution}
        client={aiClient}
        disabled={editing || saving || deleting}
        onSessionExpired={onSessionExpired}
        onPendingChange={setGenerating}
      />}
    </section>
  );
}
