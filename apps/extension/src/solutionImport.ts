import type { AiUsage, NewSolutionInput, SolutionRecord } from "./solution";

export interface ImportedSolutionDraft {
  input: NewSolutionInput;
  sourceName: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  java: "Java",
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  c: "C",
  kt: "Kotlin",
  cs: "C#",
  go: "Go",
  rs: "Rust",
  swift: "Swift",
};

const AI_USAGE_VALUES: AiUsage[] = ["used", "not_used", "unknown"];
const REQUIRED_STRING_FIELDS: Array<keyof Pick<
  SolutionRecord,
  "platform" | "problemNumber" | "title" | "language" | "code"
>> = ["platform", "problemNumber", "title", "language", "code"];

function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function basenameWithoutExtension(name: string): string {
  const fileName = name.split(/[\\/]/).pop() ?? name;
  const dotIndex = fileName.lastIndexOf(".");
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return base.trim() || "가져온 풀이";
}

export function detectLanguageFromFilename(name: string): string {
  return LANGUAGE_BY_EXTENSION[extensionOf(name)] ?? "";
}

export function importSourceFile(name: string, content: string): ImportedSolutionDraft {
  return {
    sourceName: name,
    input: {
      platform: "",
      problemNumber: "",
      title: basenameWithoutExtension(name),
      language: detectLanguageFromFilename(name),
      code: content,
      solvedAt: null,
      aiUsage: "unknown",
    },
  };
}

export function parseSolutionJson(content: string, sourceName = "CodeArchive JSON"): ImportedSolutionDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("올바른 JSON 파일이 아닙니다.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CodeArchive 풀이 JSON 형식이 아닙니다.");
  }

  const record = parsed as Partial<SolutionRecord>;
  const missingRequired = REQUIRED_STRING_FIELDS.some(
    (key) => typeof record[key] !== "string" || !record[key]!.trim(),
  );
  if (missingRequired) {
    throw new Error("JSON에 필수 풀이 데이터가 없습니다.");
  }

  if (record.solvedAt !== null && record.solvedAt !== undefined && typeof record.solvedAt !== "string") {
    throw new Error("JSON의 풀이 날짜 형식이 올바르지 않습니다.");
  }

  const aiUsage = record.aiUsage ?? "unknown";
  if (!AI_USAGE_VALUES.includes(aiUsage as AiUsage)) {
    throw new Error("JSON의 AI 활용 상태가 올바르지 않습니다.");
  }

  return {
    sourceName,
    input: {
      platform: record.platform!,
      problemNumber: record.problemNumber!,
      title: record.title!,
      language: record.language!,
      code: record.code!,
      solvedAt: record.solvedAt ?? null,
      aiUsage: aiUsage as AiUsage,
    },
  };
}
