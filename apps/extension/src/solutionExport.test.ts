import { describe, expect, it } from "vitest";
import type { SolutionRecord } from "./solution";
import {
  buildExportFilename,
  toJson,
  toMarkdown,
  toSource,
} from "./solutionExport";

const record: SolutionRecord = {
  id: "solution-1",
  platform: "BOJ",
  problemNumber: "1000",
  title: "A/B:*?",
  language: "Java",
  code: "class Main {}",
  solvedAt: "2026-08-24",
  aiUsage: "used",
  createdAt: "2026-08-24T06:00:00.000Z",
  updatedAt: "2026-08-24T07:00:00.000Z",
};

describe("solution export", () => {
  it("exports source without changing code", () => {
    expect(toSource(record)).toBe(record.code);
    expect(buildExportFilename(record, "source")).toBe("BOJ-1000-A-B.java");
  });

  it("exports markdown metadata and fenced code", () => {
    const markdown = toMarkdown(record);
    expect(markdown).toContain("# A/B:*?");
    expect(markdown).toContain("- 플랫폼: BOJ");
    expect(markdown).toContain("- 문제 번호: 1000");
    expect(markdown).toContain("```java\nclass Main {}\n```");
    expect(buildExportFilename(record, "markdown")).toBe("BOJ-1000-A-B.md");
  });

  it("exports the entire current record as pretty JSON", () => {
    expect(JSON.parse(toJson(record))).toEqual(record);
    expect(toJson(record)).toContain("\n  \"platform\": \"BOJ\"");
    expect(buildExportFilename(record, "json")).toBe("BOJ-1000-A-B.json");
  });
});
