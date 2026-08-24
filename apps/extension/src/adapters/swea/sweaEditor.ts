import { SWEA_EDITOR_SELECTORS } from "./sweaEditorSelectors";

export interface SweaEditorInfo {
  language: string | null;
  code: string;
}

export type SweaEditorDetectionResult =
  | { status: "detected"; editor: SweaEditorInfo; warnings: string[] }
  | { status: "incomplete"; language: string | null; code: string | null; missing: Array<"language" | "code">; warnings: string[] };

function firstElement<T extends Element>(document: Document, selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element as T;
  }
  return null;
}

export function normalizeSweaLanguage(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes("javascript") || normalized === "js") return "JavaScript";
  if (normalized.includes("kotlin")) return "Kotlin";
  if (normalized.includes("python")) return "Python";
  if (normalized.includes("java")) return "Java";
  if (normalized.includes("c++") || normalized.includes("cpp")) return "C++";
  if (normalized === "c" || /^c\s*\d/.test(normalized)) return "C";
  return raw;
}

function detectLanguage(document: Document, url: URL): string | null {
  const select = firstElement<HTMLSelectElement>(document, SWEA_EDITOR_SELECTORS.languageSelect);
  if (select) {
    const optionText = select.selectedOptions?.[0]?.textContent?.trim();
    return normalizeSweaLanguage(optionText || select.value);
  }

  const input = firstElement<HTMLInputElement>(document, SWEA_EDITOR_SELECTORS.languageValue);
  if (input?.value) return normalizeSweaLanguage(input.value);

  return normalizeSweaLanguage(url.searchParams.get("selectCodeLang"));
}

export function detectSweaEditor(document: Document, url: URL): SweaEditorDetectionResult {
  const warnings: string[] = [];
  const language = detectLanguage(document, url);
  const codeElement = firstElement<HTMLTextAreaElement>(document, SWEA_EDITOR_SELECTORS.code);
  const code = codeElement ? codeElement.value : null;
  const missing: Array<"language" | "code"> = [];

  if (!language) missing.push("language");
  if (code === null) missing.push("code");

  if (missing.length > 0) {
    if (code === null) warnings.push("SWEA 소스 저장 필드(#textSource)를 찾지 못했습니다.");
    if (!language) warnings.push("현재 선택 언어를 확인하지 못했습니다.");
    return { status: "incomplete", language, code, missing, warnings };
  }

  return {
    status: "detected",
    editor: { language, code },
    warnings,
  };
}
