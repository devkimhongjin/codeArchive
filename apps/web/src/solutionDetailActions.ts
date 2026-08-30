import type { DashboardSolution } from "./archiveTypes";

const COPY_SETTINGS_KEY = "codearchive.dashboard-copy-settings.v1";

export interface DashboardCopySettings {
  includeProblemInfo: boolean;
  includeLanguage: boolean;
  includePerformance: boolean;
}

export const DEFAULT_DASHBOARD_COPY_SETTINGS: DashboardCopySettings = {
  includeProblemInfo: false,
  includeLanguage: false,
  includePerformance: false,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadDashboardCopySettings(storage: StorageLike | null = typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage): DashboardCopySettings {
  if (!storage) return DEFAULT_DASHBOARD_COPY_SETTINGS;
  try {
    const raw = storage.getItem(COPY_SETTINGS_KEY);
    if (!raw) return DEFAULT_DASHBOARD_COPY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<DashboardCopySettings>;
    return {
      includeProblemInfo: parsed.includeProblemInfo === true,
      includeLanguage: parsed.includeLanguage === true,
      includePerformance: parsed.includePerformance === true,
    };
  } catch {
    return DEFAULT_DASHBOARD_COPY_SETTINGS;
  }
}

export function saveDashboardCopySettings(settings: DashboardCopySettings, storage: StorageLike | null = typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage): void {
  if (!storage) return;
  try { storage.setItem(COPY_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* preference persistence is best-effort */ }
}

function commentPrefix(language: string): "//" | "#" | "--" | null {
  const normalized = language.trim().toLowerCase().replace(/\s+/g, "");
  if (["java", "javascript", "js", "typescript", "ts", "c", "c++", "cpp", "c#", "csharp", "go", "golang", "kotlin", "swift", "rust"].includes(normalized)) return "//";
  if (["python", "python3", "py", "shell", "bash", "sh", "zsh"].includes(normalized)) return "#";
  if (["sql", "mysql", "postgresql", "postgres", "oracle", "sqlite"].includes(normalized)) return "--";
  return null;
}

export function buildDashboardCopyText(record: DashboardSolution, settings: DashboardCopySettings): string {
  if (!settings.includeProblemInfo && !settings.includeLanguage && !settings.includePerformance) return record.code;
  const prefix = commentPrefix(record.language);
  if (!prefix) return record.code;
  const annotations: string[] = [];
  if (settings.includeProblemInfo) annotations.push(`${prefix} ${record.platform} ${record.problemNumber} · ${record.title}`);
  if (settings.includeLanguage) annotations.push(`${prefix} 언어: ${record.language}`);
  if (settings.includePerformance && (record.executionTime || record.memoryUsage)) annotations.push(`${prefix} 실행시간: ${record.executionTime ?? "미입력"} · 메모리: ${record.memoryUsage ?? "미입력"}`);
  return annotations.length ? `${annotations.join("\n")}\n${record.code}` : record.code;
}

const EXTENSIONS: Record<string, string> = { java: "java", python: "py", javascript: "js", typescript: "ts", c: "c", "c++": "cpp", cpp: "cpp", kotlin: "kt", "c#": "cs", csharp: "cs", go: "go", rust: "rs", swift: "swift" };
const FENCES: Record<string, string> = { java: "java", python: "python", javascript: "javascript", typescript: "typescript", c: "c", "c++": "cpp", cpp: "cpp", kotlin: "kotlin", "c#": "csharp", csharp: "csharp", go: "go", rust: "rust", swift: "swift" };

function sanitize(value: string, fallback: string): string {
  const next = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").replace(/^-+|-+$/g, "");
  return next || fallback;
}

export function buildDashboardExportFilename(record: DashboardSolution, format: "source" | "markdown"): string {
  const base = [sanitize(record.platform, "platform"), sanitize(record.problemNumber, "problem"), sanitize(record.title, "solution")].join("-");
  if (format === "markdown") return `${base}.md`;
  return `${base}.${EXTENSIONS[record.language.trim().toLowerCase()] ?? "txt"}`;
}

export function toDashboardMarkdown(record: DashboardSolution): string {
  const fence = FENCES[record.language.trim().toLowerCase()] ?? "";
  return [`# ${record.title}`, "", `- 플랫폼: ${record.platform}`, `- 문제 번호: ${record.problemNumber}`, `- 언어: ${record.language}`, `- 풀이 날짜: ${record.solvedAt ?? "미입력"}`, `- 실행시간: ${record.executionTime ?? "미입력"}`, `- 메모리: ${record.memoryUsage ?? "미입력"}`, "", `\`\`\`${fence}`, record.code, "```", ""].join("\n");
}

export function downloadDashboardText(filename: string, content: string, mimeType = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
