import { describe, expect, it } from "vitest";
import { detectLanguageFromFilename, importSourceFile, parseSolutionJson } from "./solutionImport";

const exportedRecord = {
  id: "old-id",
  platform: "BOJ",
  problemNumber: "1000",
  title: "A+B",
  language: "Java",
  code: "class Main {}",
  solvedAt: "2026-08-24",
  aiUsage: "not_used",
  createdAt: "2026-08-24T06:00:00.000Z",
  updatedAt: "2026-08-24T07:00:00.000Z",
};

describe("solutionImport", () => {
  it("detects supported languages from filenames", () => {
    expect(detectLanguageFromFilename("Main.java")).toBe("Java");
    expect(detectLanguageFromFilename("solve.py")).toBe("Python");
    expect(detectLanguageFromFilename("answer.cxx")).toBe("C++");
    expect(detectLanguageFromFilename("main.rs")).toBe("Rust");
    expect(detectLanguageFromFilename("notes.txt")).toBe("");
  });

  it("turns a source file into an editable new-solution draft", () => {
    const imported = importSourceFile("Main.java", "class Main {}");

    expect(imported.input).toEqual({
      platform: "",
      problemNumber: "",
      title: "Main",
      language: "Java",
      code: "class Main {}",
      solvedAt: null,
      aiUsage: "unknown",
    });
  });

  it("restores exported JSON without reusing record identity fields", () => {
    const imported = parseSolutionJson(JSON.stringify(exportedRecord), "solution.json");

    expect(imported.input).toEqual({
      platform: "BOJ",
      problemNumber: "1000",
      title: "A+B",
      language: "Java",
      code: "class Main {}",
      solvedAt: "2026-08-24",
      aiUsage: "not_used",
    });
    expect(imported.input).not.toHaveProperty("id");
    expect(imported.input).not.toHaveProperty("createdAt");
    expect(imported.input).not.toHaveProperty("updatedAt");
  });

  it("rejects invalid JSON and missing required fields", () => {
    expect(() => parseSolutionJson("not-json")).toThrow("올바른 JSON 파일이 아닙니다.");
    expect(() => parseSolutionJson(JSON.stringify({ title: "A+B" }))).toThrow(
      "JSON에 필수 풀이 데이터가 없습니다.",
    );
  });
});
