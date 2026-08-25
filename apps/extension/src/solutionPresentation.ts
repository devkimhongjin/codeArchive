import type { SolutionRecord } from "./solution";
import { formatKstDateTimeMinute } from "./displayTime";

export interface SolutionGroup {
  key: string;
  representative: SolutionRecord;
  records: SolutionRecord[];
}

export function solutionProvenance(record: SolutionRecord): "PASS 자동저장" | "수동저장" {
  return record.autoCapture?.source === "SWEA_AUTO" && record.autoCapture.result === "ACCEPTED"
    ? "PASS 자동저장"
    : "수동저장";
}

export function solutionDisplayTime(record: SolutionRecord): string {
  return formatKstDateTimeMinute(record.updatedAt);
}

export function solutionGroupKey(record: Pick<SolutionRecord, "platform" | "problemNumber">): string {
  return `${record.platform}\u0000${record.problemNumber}`;
}

export function groupSolutions(records: SolutionRecord[]): SolutionGroup[] {
  const grouped = new Map<string, SolutionRecord[]>();
  for (const record of records) {
    const key = solutionGroupKey(record);
    const current = grouped.get(key);
    if (current) current.push(record);
    else grouped.set(key, [record]);
  }

  return [...grouped.entries()]
    .map(([key, groupRecords]) => {
      const sorted = [...groupRecords].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { key, representative: sorted[0], records: sorted };
    })
    .sort((a, b) => b.representative.updatedAt.localeCompare(a.representative.updatedAt));
}
