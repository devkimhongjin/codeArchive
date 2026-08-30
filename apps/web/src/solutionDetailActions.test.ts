import { describe, expect, it } from "vitest";
import type { DashboardSolution } from "./archiveTypes";
import {
  buildDashboardCopyText,
  buildDashboardExportFilename,
  loadDashboardCopySettings,
  saveDashboardCopySettings,
  toDashboardMarkdown,
} from "./solutionDetailActions";

const solution: DashboardSolution = {
  id: "solution-1",
  platform: "SWEA",
  problemNumber: "1206",
  title: "View",
  language: "Java",
  code: "class Main {}",
  solvedAt: "2026-08-30",
  updatedAt: "2026-08-30T10:00:00.000Z",
  source: "captured",
  executionTime: "123",
  memoryUsage: "45678",
};

describe("Dashboard solution detail formatting", () => {
  it("copies raw code by default and preserves the Extension-style annotation options", () => {
    expect(buildDashboardCopyText(solution, {
      includeProblemInfo: false,
      includeLanguage: false,
      includePerformance: false,
    })).toBe("class Main {}");

    expect(buildDashboardCopyText(solution, {
      includeProblemInfo: true,
      includeLanguage: true,
      includePerformance: true,
    })).toBe([
      "// SWEA 1206 · View",
      "// 언어: Java",
      "// 실행시간: 123 · 메모리: 45678",
      "class Main {}",
    ].join("\n"));
  });

  it("stores only the client formatting preference", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    saveDashboardCopySettings({ includeProblemInfo: true, includeLanguage: false, includePerformance: true }, storage);
    expect(loadDashboardCopySettings(storage)).toEqual({
      includeProblemInfo: true,
      includeLanguage: false,
      includePerformance: true,
    });
    expect([...values.values()]).toEqual([JSON.stringify({ includeProblemInfo: true, includeLanguage: false, includePerformance: true })]);
  });

  it("creates safe source and Markdown filenames", () => {
    expect(buildDashboardExportFilename(solution, "source")).toBe("SWEA-1206-View.java");
    expect(buildDashboardExportFilename({ ...solution, title: "bad:/title" }, "markdown")).toBe("SWEA-1206-bad-title.md");
  });

  it("exports Markdown from the selected server-backed solution", () => {
    const markdown = toDashboardMarkdown(solution);
    expect(markdown).toContain("# View");
    expect(markdown).toContain("- 플랫폼: SWEA");
    expect(markdown).toContain("- 문제 번호: 1206");
    expect(markdown).toContain("```java\nclass Main {}\n```");
  });
});
