import { useState } from "react";
import type { DashboardSolution } from "./archiveTypes";
import {
  buildDashboardCopyText,
  buildDashboardExportFilename,
  downloadDashboardText,
  loadDashboardCopySettings,
  saveDashboardCopySettings,
  toDashboardMarkdown,
  type DashboardCopySettings,
} from "./solutionDetailActions";

interface SolutionDetailActionsProps {
  solution: DashboardSolution;
  copyText?: (text: string) => Promise<void>;
  downloadText?: (filename: string, content: string, mimeType?: string) => void;
}

export function SolutionDetailActions({
  solution,
  copyText = (text) => navigator.clipboard.writeText(text),
  downloadText = downloadDashboardText,
}: SolutionDetailActionsProps) {
  const [settings, setSettings] = useState<DashboardCopySettings>(() => loadDashboardCopySettings());
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

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

  return (
    <section className="solution-tools" aria-label="풀이 도구">
      <div className="solution-tool-heading">
        <strong>풀이 도구</strong>
        <span>현재 선택한 서버 풀이에만 적용됩니다.</span>
      </div>
      <div className="solution-tool-actions">
        <button className="primary-button" type="button" onClick={() => void copyCode()}>코드 복사</button>
        <button type="button" onClick={() => download("source")}>Source 다운로드</button>
        <button type="button" onClick={() => download("markdown")}>Markdown 다운로드</button>
      </div>
      <fieldset className="copy-settings">
        <legend>복사·Source 형식</legend>
        <label><input type="checkbox" checked={settings.includeProblemInfo} onChange={() => changeSetting("includeProblemInfo")} /> 문제 정보 주석</label>
        <label><input type="checkbox" checked={settings.includeLanguage} onChange={() => changeSetting("includeLanguage")} /> 언어 주석</label>
        <label><input type="checkbox" checked={settings.includePerformance} onChange={() => changeSetting("includePerformance")} /> 실행시간·메모리 주석</label>
      </fieldset>
      {feedback && <p className="tool-feedback" role="status">{feedback}</p>}
      {error && <p className="tool-error" role="alert">{error}</p>}
    </section>
  );
}
