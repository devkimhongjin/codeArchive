import { describe, expect, it } from "vitest";
import { archiveFilterOptions, EMPTY_ARCHIVE_FILTERS, filterDashboardSolutions } from "./archiveFilters";
import type { DashboardSolution } from "./archiveTypes";

const records: DashboardSolution[] = [
  { id: "a", platform: "SWEA", problemNumber: "10", title: "숫자 찾기", language: "Java", code: "secret needle", solvedAt: null, updatedAt: "2026-08-31", source: "captured" },
  { id: "b", platform: "SWEA", problemNumber: "2", title: "숫자 찾기", language: "Python", code: "", solvedAt: null, updatedAt: "2026-08-30", source: "captured" },
  { id: "c", platform: "PROGRAMMERS", problemNumber: "10", title: "숫자 찾기", language: "Java", code: "", solvedAt: null, updatedAt: "2026-08-29", source: "captured" },
];

describe("archive filters", () => {
  it("combines trimmed case-insensitive metadata search with exact platform/language filters", () => {
    expect(filterDashboardSolutions(records, { query: "  jAvA  ", platform: "SWEA", language: "Java" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterDashboardSolutions(records, { query: "10", platform: "PROGRAMMERS", language: "Python" })).toEqual([]);
    expect(filterDashboardSolutions(records, { ...EMPTY_ARCHIVE_FILTERS, query: "needle" })).toEqual([]);
    expect(filterDashboardSolutions(records, { ...EMPTY_ARCHIVE_FILTERS, query: "   " })).toEqual(records);
  });

  it("derives unique options from loaded data, without inventing supported platforms", () => {
    expect(archiveFilterOptions([...records, records[0]])).toEqual({
      platforms: ["PROGRAMMERS", "SWEA"], languages: ["Java", "Python"],
    });
    expect(archiveFilterOptions([])).toEqual({ platforms: [], languages: [] });
    expect(records.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
