import { beforeEach, describe, expect, it } from "vitest";
import type { SolutionRecord } from "./solution";
import { buildCopyText, DEFAULT_COPY_SETTINGS, loadCopySettings, saveCopySettings } from "./copySettings";

const record: SolutionRecord = {
  id: "1", platform: "SWEA", problemNumber: "1234", title: "Sample", language: "Java", code: "class Main {}",
  solvedAt: null, aiUsage: "unknown", createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
  performance: { executionTime: "10 ms", memoryUsage: "20 kb" },
};

describe("copy settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to raw code and persists settings", () => {
    expect(loadCopySettings()).toEqual(DEFAULT_COPY_SETTINGS);
    expect(buildCopyText(record, DEFAULT_COPY_SETTINGS)).toBe("class Main {}");
    const settings = { includeProblemInfo: true, includeLanguage: false, includePerformance: true };
    saveCopySettings(settings);
    expect(loadCopySettings()).toEqual(settings);
  });

  it.each([
    ["Java", "//"], ["JS", "//"], ["C++", "//"], ["Kotlin", "//"],
    ["Python", "#"], ["Shell", "#"], ["SQL", "--"],
  ])("uses the expected comment prefix for %s", (language, prefix) => {
    const text = buildCopyText({ ...record, language }, { includeProblemInfo: true, includeLanguage: false, includePerformance: false });
    expect(text).toBe(`${prefix} SWEA 1234 · Sample\nclass Main {}`);
  });

  it("falls back to raw code for unknown languages", () => {
    expect(buildCopyText({ ...record, language: "MysteryLang" }, { includeProblemInfo: true, includeLanguage: true, includePerformance: true })).toBe(record.code);
  });

  it("omits performance annotation when performance is absent", () => {
    const { performance: _performance, ...withoutPerformance } = record;
    expect(buildCopyText(withoutPerformance, { includeProblemInfo: false, includeLanguage: false, includePerformance: true })).toBe(record.code);
  });
});
