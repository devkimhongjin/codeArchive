import { describe, expect, it } from "vitest";
import { groupDashboardSolutions, type DashboardSolution } from "./archiveTypes";

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

  it("sorts groups and submissions oldest first but keeps the latest problem title", () => {
    const record = (id: string, problemNumber: string, updatedAt: string): DashboardSolution => ({
      id, platform: "SWEA", problemNumber, updatedAt, title: id, language: "Java", code: "", solvedAt: null, source: "captured",
    });
    const input = [record("new", "10", "2026-08-31"), record("other", "2", "2026-08-29"), record("old", "10", "2026-08-28")];
    const groups = groupDashboardSolutions(input, "updated_asc");
    expect(groups.map((g) => g.problemNumber)).toEqual(["10", "2"]);
    expect(groups[0].records.map((r) => r.id)).toEqual(["old", "new"]);
    expect(groups[0].title).toBe("new");
    expect(groupDashboardSolutions(input, "problem_number").map((g) => g.problemNumber)).toEqual(["2", "10"]);
    expect(groupDashboardSolutions(input, "problem_number")[1].records.map((r) => r.id)).toEqual(["new", "old"]);
    expect(input.map((r) => r.id)).toEqual(["new", "other", "old"]);
  });

  it("compares timestamps by instant, keeps invalid dates last, and breaks ties consistently", () => {
    const record = (id: string, updatedAt: string, problemNumber = id): DashboardSolution => ({
      id, platform: "SWEA", problemNumber, updatedAt, title: id, language: "Java", code: "", solvedAt: null, source: "captured",
    });
    const records = [record("unknown", "invalid"), record("early", "2026-08-31T10:00:00+09:00"), record("late", "2026-08-31T02:00:00Z")];
    expect(groupDashboardSolutions(records).map((g) => g.records[0].id)).toEqual(["late", "early", "unknown"]);
    expect(groupDashboardSolutions(records, "updated_asc").map((g) => g.records[0].id)).toEqual(["early", "late", "unknown"]);
    const ties = [record("b", "2026-08-31", "2"), record("a", "2026-08-31", "2")];
    expect(groupDashboardSolutions(ties)[0].records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(groupDashboardSolutions([...ties].reverse())[0].records.map((r) => r.id)).toEqual(["a", "b"]);
    const mixed = [{ ...record("p", "2026-08-31", "10"), platform: "PROGRAMMERS" }, record("s", "2026-08-31", "2")];
    expect(groupDashboardSolutions(mixed, "problem_number").map((g) => g.key)).toEqual(["PROGRAMMERS:10", "SWEA:2"]);
  });
});
