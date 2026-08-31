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

/** Filter only the authenticated records already loaded by the archive. */
export function filterDashboardSolutions(
  records: readonly DashboardSolution[],
  filters: ArchiveFilters,
): DashboardSolution[] {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) =>
    (!filters.platform || record.platform === filters.platform)
    && (!filters.language || record.language === filters.language)
    && (!query || [record.platform, record.problemNumber, record.title, record.language]
      .join(" ").toLowerCase().includes(query)),
  );
}

export function archiveFilterOptions(records: readonly DashboardSolution[]) {
  const values = (field: "platform" | "language") =>
    [...new Set(records.map((record) => record[field]).filter((value) => value.trim()))]
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0));
  return { platforms: values("platform"), languages: values("language") };
}
