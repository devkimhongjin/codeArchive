import type { DashboardSolution } from "./archiveTypes";

export interface ArchiveFilters {
  query: string;
  platform: string;
  language: string;
}

export const EMPTY_ARCHIVE_FILTERS: ArchiveFilters = {
  query: "",
  platform: "",
  language: "",
};

/** Presentation-only language labels; persisted/API values remain unchanged. */
export function displayLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = { java: "Java", python: "Python", python3: "Python", javascript: "JavaScript", typescript: "TypeScript", "c++": "C++", cpp: "C++", c: "C", "c#": "C#", go: "Go", kotlin: "Kotlin", ruby: "Ruby", swift: "Swift", scala: "Scala" };
  return labels[normalized] ?? value.trim();
}

/** Filter only the authenticated records already loaded by the archive. */
export function filterDashboardSolutions(
  records: readonly DashboardSolution[],
  filters: ArchiveFilters,
): DashboardSolution[] {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) =>
    (!filters.platform || record.platform === filters.platform)
    && (!filters.language || displayLanguage(record.language) === filters.language)
    && (!query || [record.platform, record.problemNumber, record.title, record.language]
      .join(" ").toLowerCase().includes(query)),
  );
}

export function archiveFilterOptions(records: readonly DashboardSolution[]) {
  const values = (field: "platform" | "language") =>
    [...new Set(records.map((record) => field === "language" ? displayLanguage(record[field]) : record[field]).filter((value) => value.trim()))]
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0));
  return { platforms: values("platform"), languages: values("language") };
}
