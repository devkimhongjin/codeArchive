import { PROGRAMMERS_SELECTORS } from "./programmersSelectors";

export interface ProgrammersEditorInfo {
  language: string;
  code: string;
}

export type ProgrammersEditorDetectionResult =
  | { status: "detected"; editor: ProgrammersEditorInfo; warnings: string[] }
  | { status: "incomplete"; language: string | null; code: string | null; missing: Array<"language" | "code">; warnings: string[] };

export function normalizeProgrammersLanguage(value: string | null | undefined): string | null {
  const raw = value?.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "python3" || normalized === "python") return "Python";
  if (normalized === "javascript") return "JavaScript";
  if (normalized === "kotlin") return "Kotlin";
  if (normalized === "java") return "Java";
  if (normalized === "c++") return "C++";
  if (normalized === "c#") return "C#";
  if (normalized === "go") return "Go";
  if (normalized === "ruby") return "Ruby";
  if (normalized === "scala") return "Scala";
  if (normalized === "swift") return "Swift";
  return raw;
}

export function detectProgrammersEditor(document: Document): ProgrammersEditorDetectionResult {
  const languageElement = document.querySelector(PROGRAMMERS_SELECTORS.language[0]);
  const language = normalizeProgrammersLanguage(languageElement?.textContent);
  const codeElement = document.querySelector<HTMLTextAreaElement>(PROGRAMMERS_SELECTORS.code[0]);
  const code = codeElement ? codeElement.value : null;
  const missing: Array<"language" | "code"> = [];
  const warnings: string[] = [];

  if (!language) {
    missing.push("language");
    warnings.push("현재 선택 언어를 확인하지 못했습니다.");
  }
  if (code === null) {
    missing.push("code");
    warnings.push("프로그래머스 소스 저장 필드(#code)를 찾지 못했습니다.");
  }

  return language !== null && code !== null
    ? { status: "detected", editor: { language, code }, warnings }
    : { status: "incomplete", language, code, missing, warnings };
}
