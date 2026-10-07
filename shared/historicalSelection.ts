export type HistoricalSelectionMode = "all" | "latest" | "fastest" | "lowest-memory";

export type HistoricalCandidate = {
  submissionId?: string;
  problemNumber: string;
  executionTime?: number;
  memoryValue?: number;
};

/** The input order is the site's newest-first order and is retained for ties. */
export function selectHistoricalSubmissionIds(candidates: HistoricalCandidate[], mode: HistoricalSelectionMode): string[] {
  if (mode === "all") return candidates.flatMap(item => item.submissionId ? [item.submissionId] : []);
  const winner = new Map<string, HistoricalCandidate>();
  const value = (item: HistoricalCandidate, key: "executionTime" | "memoryValue") =>
    typeof item[key] === "number" && Number.isFinite(item[key]) && item[key]! >= 0 ? item[key]! : Number.POSITIVE_INFINITY;
  for (const item of candidates) {
    if (!item.submissionId || !item.problemNumber) continue;
    const previous = winner.get(item.problemNumber);
    if (!previous) { winner.set(item.problemNumber, item); continue; }
    if (mode === "latest") continue;
    const primary = mode === "fastest" ? "executionTime" : "memoryValue";
    const secondary = mode === "fastest" ? "memoryValue" : "executionTime";
    if (value(item, primary) < value(previous, primary) ||
      (value(item, primary) === value(previous, primary) && value(item, secondary) < value(previous, secondary))) winner.set(item.problemNumber, item);
  }
  const selected = new Set([...winner.values()].flatMap(item => item.submissionId ? [item.submissionId] : []));
  return candidates.flatMap(item => item.submissionId && selected.has(item.submissionId) ? [item.submissionId] : []);
}
