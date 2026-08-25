import type { SolutionRecord } from "./solution";
import { formatKstDateTimeMinute } from "./displayTime";

export function solutionProvenance(record: SolutionRecord): "PASS 자동저장" | "수동저장" {
  return record.autoCapture?.source === "SWEA_AUTO" && record.autoCapture.result === "ACCEPTED"
    ? "PASS 자동저장"
    : "수동저장";
}

export function solutionDisplayTime(record: SolutionRecord): string {
  return formatKstDateTimeMinute(record.autoCapture?.observedAt ?? record.updatedAt);
}
