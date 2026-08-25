import { describe, expect, it } from "vitest";
import { toJson, toMarkdown } from "./solutionExport";
import type { SolutionRecord } from "./solution";

const record: SolutionRecord = {
  id: "swea-auto:test",
  platform: "SWEA",
  problemNumber: "1234",
  title: "Synthetic",
  language: "Java",
  code: "class Main {}",
  solvedAt: "2026-08-25",
  aiUsage: "unknown",
  performance: { executionTime: "67 ms", memoryUsage: "12,345 kb" },
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-25T01:11:00.000Z" },
  createdAt: "2026-08-25T01:11:01.000Z",
  updatedAt: "2026-08-25T01:11:01.000Z",
};

describe("solution performance", () => {
  it("keeps performance strings in JSON and Markdown exports", () => {
    expect(JSON.parse(toJson(record)).performance).toEqual({ executionTime: "67 ms", memoryUsage: "12,345 kb" });
    expect(toMarkdown(record)).toContain("- 실행시간: 67 ms");
    expect(toMarkdown(record)).toContain("- 메모리: 12,345 kb");
  });
});
