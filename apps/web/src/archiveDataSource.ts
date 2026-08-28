import type { DashboardArchiveDataSource, DashboardSolution } from "./archiveTypes";

const bootstrapRecords: readonly DashboardSolution[] = [
  {
    id: "demo-swea-1234-java",
    platform: "SWEA",
    problemNumber: "1234",
    title: "중위순회",
    language: "Java",
    code: "class Solution {\n  public static void main(String[] args) {\n    // Dashboard bootstrap fixture\n  }\n}",
    solvedAt: "2026-08-27",
    updatedAt: "2026-08-27T12:40:00.000Z",
    source: "captured",
    executionTime: "112 ms",
    memoryUsage: "24 MB",
  },
  {
    id: "demo-swea-1234-python",
    platform: "SWEA",
    problemNumber: "1234",
    title: "중위순회",
    language: "Python",
    code: "def solve():\n    # Dashboard bootstrap fixture\n    pass\n",
    solvedAt: "2026-08-26",
    updatedAt: "2026-08-26T09:20:00.000Z",
    source: "manual",
  },
  {
    id: "demo-swea-1954-java",
    platform: "SWEA",
    problemNumber: "1954",
    title: "달팽이 숫자",
    language: "Java",
    code: "class Solution {\n  // Later slices replace this fixture through DashboardArchiveDataSource.\n}",
    solvedAt: "2026-08-25",
    updatedAt: "2026-08-25T07:10:00.000Z",
    source: "captured",
  },
];

/**
 * Bootstrap-only data source. Later authenticated Main API work replaces this
 * adapter without coupling the Dashboard UI to Extension IndexedDB.
 */
export const bootstrapArchiveDataSource: DashboardArchiveDataSource = {
  async listSolutions() {
    return bootstrapRecords;
  },
};
