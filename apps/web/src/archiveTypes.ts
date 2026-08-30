export type DashboardAiUsage = "used" | "not_used" | "unknown";

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
  clientRecordId?: string;
  result?: string;
  observedAt?: string | null;
  aiUsage?: DashboardAiUsage | null;
  createdAt?: string;
}

export interface DashboardServerSolution extends DashboardSolution {
  clientRecordId: string;
  result: string;
  observedAt: string | null;
  aiUsage: DashboardAiUsage | null;
  createdAt: string;
}

export function isDashboardServerSolution(
  solution: DashboardSolution,
): solution is DashboardServerSolution {
  return typeof solution.clientRecordId === "string"
    && solution.clientRecordId.trim().length > 0
    && typeof solution.result === "string"
    && solution.result.trim().length > 0
    && (solution.observedAt === null || typeof solution.observedAt === "string")
    && (solution.aiUsage === null
      || solution.aiUsage === "used"
      || solution.aiUsage === "not_used"
      || solution.aiUsage === "unknown")
    && typeof solution.createdAt === "string";
}

export interface DashboardArchiveDataSource {
  listSolutions(signal?: AbortSignal): Promise<readonly DashboardSolution[]>;
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
