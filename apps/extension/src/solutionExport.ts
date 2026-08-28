import type { SolutionRecord } from "./solution";
import { buildCopyText, type CopySettings } from "./copySettings";

export type ExportFormat = "source" | "markdown" | "json";

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  java: "java",
  python: "py",
  javascript: "js",
  typescript: "ts",
  "c++": "cpp",
};

const LANGUAGE_FENCES: Record<string, string> = {
  java: "java",
  python: "python",
  javascript: "javascript",
  typescript: "typescript",
  "c++": "cpp",
};

const AI_USAGE_LABELS: Record<SolutionRecord["aiUsage"], string> = {
  used: "사용함",
  not_used: "사용 안 함",
  unknown: "모름",
};

export function toSource(record: SolutionRecord): string {
  return record.code;
}

export function toConfiguredSource(record: SolutionRecord, settings: CopySettings): string {
  return buildCopyText(record, settings);
}

export function toMarkdown(record: SolutionRecord): string {
  const language = record.language.trim().toLowerCase();
  const fence = LANGUAGE_FENCES[language] ?? "";

  return [
    `# ${record.title}`,
    "",
    `- 플랫폼: ${record.platform}`,
    `- 문제 번호: ${record.problemNumber}`,
    `- 언어: ${record.language}`,
    `- 풀이 날짜: ${record.solvedAt ?? "미입력"}`,
    `- AI 활용: ${AI_USAGE_LABELS[record.aiUsage]}`,
    "",
    `\`\`\`${fence}`,
    record.code,
    "```",
    "",
  ].join("\n");
}

export function toJson(record: SolutionRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function sanitizeFilenamePart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

export function buildExportFilename(record: SolutionRecord, format: ExportFormat): string {
  const base = [
    sanitizeFilenamePart(record.platform, "platform"),
    sanitizeFilenamePart(record.problemNumber, "problem"),
    sanitizeFilenamePart(record.title, "solution"),
  ].join("-");

  if (format === "markdown") {
    return `${base}.md`;
  }
  if (format === "json") {
    return `${base}.json`;
  }

  const extension = LANGUAGE_EXTENSIONS[record.language.trim().toLowerCase()] ?? "txt";
  return `${base}.${extension}`;
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/plain;charset=utf-8"): void {
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
