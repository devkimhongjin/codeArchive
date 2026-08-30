import type { DashboardArchiveDataSource, DashboardSolution } from "./archiveTypes";
import { MAIN_API_ORIGIN } from "./authClient";
import { withRequestDeadline } from "./requestDeadline";

export class ArchiveSessionExpiredError extends Error {}

const SOLUTIONS_URL = `${MAIN_API_ORIGIN}/api/v1/solutions?limit=50`;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function parseSolution(value: unknown): DashboardSolution | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.platform !== "string"
    || typeof value.problemNumber !== "string"
    || typeof value.title !== "string"
    || typeof value.language !== "string"
    || typeof value.code !== "string"
    || !optionalString(value.solvedAt)
    || typeof value.updatedAt !== "string"
    || !optionalString(value.executionTime)
    || !optionalString(value.memoryUsage)
  ) return null;

  return {
    id: value.id,
    platform: value.platform,
    problemNumber: value.problemNumber,
    title: value.title,
    language: value.language,
    code: value.code,
    solvedAt: value.solvedAt ?? null,
    updatedAt: value.updatedAt,
    source: "captured",
    ...(value.executionTime ? { executionTime: value.executionTime } : {}),
    ...(value.memoryUsage ? { memoryUsage: value.memoryUsage } : {}),
  };
}

function parseSolutionsEnvelope(value: unknown): readonly DashboardSolution[] | null {
  if (!isObject(value) || value.success !== true || !Array.isArray(value.data)) return null;
  const records = value.data.map(parseSolution);
  return records.every((record): record is DashboardSolution => record !== null)
    ? records
    : null;
}

export function createMainApiArchiveDataSource(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): DashboardArchiveDataSource {
  return {
    async listSolutions(signal) {
      return withRequestDeadline(async (requestSignal) => {
        const response = await fetcher(SOLUTIONS_URL, {
          method: "GET",
          credentials: "include",
          signal: requestSignal,
        });
        if (response.status === 401) throw new ArchiveSessionExpiredError("session expired");
        if (!response.ok) throw new Error("archive request failed");
        const records = parseSolutionsEnvelope(await response.json());
        if (!records) throw new Error("archive response invalid");
        return records;
      }, signal);
    },
  };
}

export const mainApiArchiveDataSource = createMainApiArchiveDataSource();
