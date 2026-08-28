import { describe, expect, it } from "vitest";
import type { SolutionRecord } from "./solution";
import { groupSolutions, solutionDisplayTime } from "./solutionPresentation";

const base: SolutionRecord = {
  id: "a", platform: "SWEA", problemNumber: "1000", title: "A", language: "Java", code: "code",
  solvedAt: null, aiUsage: "unknown", createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z",
};

describe("solution presentation", () => {
  it("groups only by platform + problemNumber and orders groups/children by updatedAt desc", () => {
    const groups = groupSolutions([
      { ...base, id: "old", updatedAt: "2026-08-24T10:00:00.000Z" },
      { ...base, id: "new", title: "Newest title", updatedAt: "2026-08-24T13:00:00.000Z" },
      { ...base, id: "other-platform", platform: "BOJ", updatedAt: "2026-08-24T14:00:00.000Z" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].representative.id).toBe("other-platform");
    expect(groups[1].representative.id).toBe("new");
    expect(groups[1].records.map((record) => record.id)).toEqual(["new", "old"]);
  });

  it("uses updatedAt for general record display even for auto captures", () => {
    const record = { ...base, updatedAt: "2026-08-24T15:00:00.000Z", autoCapture: { source: "SWEA_AUTO" as const, result: "ACCEPTED" as const, observedAt: "2026-08-24T10:00:00.000Z" } };
    expect(solutionDisplayTime(record)).toBe("2026-08-25 00:00");
  });
});
