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

export type ArchiveSortOrder = "updated_desc" | "updated_asc" | "problem_number";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareProblem(a: DashboardSolution, b: DashboardSolution): number {
  // Platform first: problem numbers from different judges are not comparable.
  return a.platform.localeCompare(b.platform, "ko", { numeric: true })
    || compareText(a.platform, b.platform)
    || a.problemNumber.localeCompare(b.problemNumber, "ko", { numeric: true })
    || compareText(a.problemNumber, b.problemNumber);
}

function compareUpdated(a: DashboardSolution, b: DashboardSolution, oldestFirst = false): number {
  const left = Date.parse(a.updatedAt);
  const right = Date.parse(b.updatedAt);
  // Unparseable dates always follow known timestamps, in either direction.
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number(Number.isFinite(right)) - Number(Number.isFinite(left));
  }
  return oldestFirst ? left - right : right - left;
}

export function groupDashboardSolutions(
  records: readonly DashboardSolution[],
  order: ArchiveSortOrder = "updated_desc",
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
      const newest = [...groupRecords].sort((a, b) => compareUpdated(a, b) || compareText(a.id, b.id));
      // Changing sort order must not replace a problem's latest title with an old one.
      const representative = newest[0];
      const sorted = order === "updated_asc"
        ? [...newest].sort((a, b) => compareUpdated(a, b, true) || compareText(a.id, b.id))
        : newest;
      return {
        key,
        platform: representative.platform,
        problemNumber: representative.problemNumber,
        title: representative.title,
        records: sorted,
      };
    })
    .sort((a, b) => {
      const left = a.records[0];
      const right = b.records[0];
      return (order === "problem_number"
        ? compareProblem(left, right)
        : compareUpdated(left, right, order === "updated_asc") || compareProblem(left, right))
        || compareText(left.id, right.id);
    });
}
