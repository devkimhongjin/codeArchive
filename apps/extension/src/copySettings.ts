import type { SolutionRecord } from "./solution";

const STORAGE_KEY = "codearchive.copy-settings.v1";

export interface CopySettings {
  includeProblemInfo: boolean;
  includeLanguage: boolean;
  includePerformance: boolean;
}

export const DEFAULT_COPY_SETTINGS: CopySettings = {
  includeProblemInfo: false,
  includeLanguage: false,
  includePerformance: false,
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadCopySettings(storage: StorageLike = localStorage): CopySettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COPY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CopySettings>;
    return {
      includeProblemInfo: parsed.includeProblemInfo === true,
      includeLanguage: parsed.includeLanguage === true,
      includePerformance: parsed.includePerformance === true,
    };
  } catch {
    return DEFAULT_COPY_SETTINGS;
  }
}

export function saveCopySettings(settings: CopySettings, storage: StorageLike = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function commentPrefix(language: string): "//" | "#" | "--" | null {
  const normalized = language.trim().toLowerCase().replace(/\s+/g, "");
  if (["java", "javascript", "js", "typescript", "ts", "c", "c++", "cpp", "c#", "csharp", "go", "golang", "kotlin", "swift", "rust"].includes(normalized)) return "//";
  if (["python", "python3", "py", "shell", "bash", "sh", "zsh"].includes(normalized)) return "#";
  if (["sql", "mysql", "postgresql", "postgres", "oracle", "sqlite"].includes(normalized)) return "--";
  return null;
}

export function buildCopyText(record: SolutionRecord, settings: CopySettings): string {
  if (!settings.includeProblemInfo && !settings.includeLanguage && !settings.includePerformance) return record.code;
  const prefix = commentPrefix(record.language);
  if (!prefix) return record.code;

  const annotations: string[] = [];
  if (settings.includeProblemInfo) annotations.push(`${prefix} ${record.platform} ${record.problemNumber} · ${record.title}`);
  if (settings.includeLanguage) annotations.push(`${prefix} 언어: ${record.language}`);
  if (settings.includePerformance && record.performance) {
    annotations.push(`${prefix} 실행시간: ${record.performance.executionTime} · 메모리: ${record.performance.memoryUsage}`);
  }
  return annotations.length === 0 ? record.code : `${annotations.join("\n")}\n${record.code}`;
}
