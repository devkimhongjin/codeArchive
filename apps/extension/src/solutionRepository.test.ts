import { describe, expect, it } from "vitest";
import { canEnrichAcceptedCapturePerformance } from "./solutionRepository";
import type { SolutionRecord } from "./solution";

const savedAt = "2026-08-24T12:00:01.000Z";
const record: SolutionRecord = {
  id: "swea-auto:uuid",
  clientRecordId: "client-uuid",
  platform: "SWEA",
  problemNumber: "1234",
  title: "Synthetic title",
  language: "Java",
  code: "latest",
  solvedAt: "2026-08-24",
  aiUsage: "unknown",
  createdAt: savedAt,
  updatedAt: savedAt,
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" },
};

describe("late SWEA performance enrichment guard", () => {
  it("only accepts the untouched original SWEA capture", () => {
    expect(canEnrichAcceptedCapturePerformance(record, savedAt)).toBe(true);
    expect(canEnrichAcceptedCapturePerformance({ ...record, updatedAt: "2026-08-24T12:01:00.000Z" }, savedAt)).toBe(false);
    expect(canEnrichAcceptedCapturePerformance({ ...record, performance: { executionTime: "1 ms", memoryUsage: "2 kb" } }, savedAt)).toBe(false);
    expect(canEnrichAcceptedCapturePerformance({ ...record, platform: "PROGRAMMERS" }, savedAt)).toBe(false);
  });
});
