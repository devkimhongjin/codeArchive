import { describe, expect, it } from "vitest";
import type { SolutionRecord } from "./solution";
import { migrateCaptureIdentity, toCaptureImportRecord } from "./solutionRepository";

function acceptedRecord(overrides: Partial<SolutionRecord> = {}): SolutionRecord {
  return {
    id: "swea-auto:legacy-capture",
    platform: "SWEA",
    problemNumber: "1234",
    title: "Synthetic title",
    language: "Java",
    code: "class Solution {}",
    solvedAt: "2026-08-28",
    aiUsage: "unknown",
    createdAt: "2026-08-28T01:00:00.000Z",
    updatedAt: "2026-08-28T01:00:00.000Z",
    autoCapture: {
      source: "SWEA_AUTO",
      result: "ACCEPTED",
      observedAt: "2026-08-28T01:00:00.000Z",
      problemUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current",
    },
    ...overrides,
  };
}

describe("capture bridge storage identity", () => {
  it("migrates a legacy accepted capture to its existing immutable Extension id", () => {
    const migrated = migrateCaptureIdentity(acceptedRecord());
    expect(migrated.clientRecordId).toBe("swea-auto:legacy-capture");
    expect(migrated.id).toBe("swea-auto:legacy-capture");
  });

  it("never replaces an existing clientRecordId and leaves non-capture records untouched", () => {
    const existing = acceptedRecord({ clientRecordId: "capture-uuid" });
    expect(migrateCaptureIdentity(existing)).toBe(existing);

    const manual = acceptedRecord({ autoCapture: undefined, clientRecordId: undefined });
    expect(migrateCaptureIdentity(manual)).toBe(manual);
    expect(manual.clientRecordId).toBeUndefined();
  });

  it("maps accepted local capture to the frozen source-bearing shared record without account/auth fields", () => {
    const record = acceptedRecord({ clientRecordId: "capture-uuid" });
    const imported = toCaptureImportRecord(record);

    expect(imported).toEqual({
      clientRecordId: "capture-uuid",
      problem: {
        platform: "SWEA",
        platformProblemId: "1234",
        problemNumber: "1234",
        title: "Synthetic title",
        url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current",
        tags: [],
      },
      language: "JAVA",
      code: "class Solution {}",
      result: "ACCEPTED",
      submittedAt: "2026-08-28T01:00:00.000Z",
    });
    expect(JSON.stringify(imported)).not.toMatch(/userId|github|token|cookie|sync|serverSolutionId/i);
  });

  it("preserves Programmers identity when bridging an accepted local capture", () => {
    const imported = toCaptureImportRecord(acceptedRecord({
      id: "programmers-auto:capture",
      clientRecordId: "programmers-capture",
      platform: "PROGRAMMERS",
      problemNumber: "42842",
      title: "카펫",
      language: "Python3",
      autoCapture: {
        source: "PROGRAMMERS_AUTO",
        result: "ACCEPTED",
        observedAt: "2026-09-01T00:00:00.000Z",
        problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/42842",
      },
    }));

    expect(imported.problem.platform).toBe("PROGRAMMERS");
    expect(imported.problem.platformProblemId).toBe("42842");
    expect(imported.language).toBe("PYTHON");
  });
});
