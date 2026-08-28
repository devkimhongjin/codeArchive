export interface DashboardSolution {
  id: string;
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  solvedAt: string | null;
  updatedAt: string;
  source: "captured" | "manual";
  executionTime?: string;
  memoryUsage?: string;
}

export interface DashboardArchiveDataSource {
  listSolutions(): Promise<readonly DashboardSolution[]>;
}

export interface DashboardProblemGroup {
  key: string;
  platform: string;
  problemNumber: string;
  title: string;
  records: readonly DashboardSolution[];
}

export function groupDashboardSolutions(
  records: readonly DashboardSolution[],
): DashboardProblemGroup[] {
  const groups = new Map<string, DashboardSolution[]>();
  for (const record of records) {
    const key = `${record.platform}:${record.problemNumber}`;
    const current = groups.get(key) ?? [];
    current.push(record);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([key, groupRecords]) => {
      const sorted = [...groupRecords].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const representative = sorted[0];
      return {
        key,
        platform: representative.platform,
        problemNumber: representative.problemNumber,
        title: representative.title,
        records: sorted,
      };
    })
    .sort((a, b) => b.records[0].updatedAt.localeCompare(a.records[0].updatedAt));
}
