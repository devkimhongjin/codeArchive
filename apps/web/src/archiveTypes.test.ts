import { describe, expect, it } from "vitest";
import { groupDashboardSolutions } from "./archiveTypes";

describe("groupDashboardSolutions", () => {
  it("groups repeated submissions by platform/problem and sorts newest first", () => {
    const groups = groupDashboardSolutions([
      {
        id: "old",
        platform: "SWEA",
        problemNumber: "1234",
        title: "중위순회",
        language: "Java",
        code: "old",
        solvedAt: null,
        updatedAt: "2026-08-20T00:00:00.000Z",
        source: "manual",
      },
      {
        id: "new",
        platform: "SWEA",
        problemNumber: "1234",
        title: "중위순회",
        language: "Python",
        code: "new",
        solvedAt: null,
        updatedAt: "2026-08-21T00:00:00.000Z",
        source: "captured",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].records.map((record) => record.id)).toEqual(["new", "old"]);
  });
});
