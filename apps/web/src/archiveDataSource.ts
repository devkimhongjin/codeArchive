import type { DashboardAiUsage, DashboardArchiveDataSource, DashboardServerSolution } from "./archiveTypes";
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

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableAiUsage(value: unknown): value is DashboardAiUsage | null {
  return value === null || value === "used" || value === "not_used" || value === "unknown";
}

export function parseDashboardServerSolution(value: unknown): DashboardServerSolution | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.clientRecordId !== "string"
    || !value.clientRecordId.trim()
    || typeof value.platform !== "string"
    || typeof value.problemNumber !== "string"
    || typeof value.title !== "string"
    || typeof value.language !== "string"
    || typeof value.code !== "string"
    || typeof value.result !== "string"
    || !value.result.trim()
    || !nullableString(value.solvedAt)
    || !nullableString(value.observedAt)
    || !optionalString(value.executionTime)
    || !optionalString(value.memoryUsage)
    || !nullableAiUsage(value.aiUsage)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
  ) return null;

  return {
    id: value.id,
    clientRecordId: value.clientRecordId,
    platform: value.platform,
    problemNumber: value.problemNumber,
    title: value.title,
    language: value.language,
    code: value.code,
    result: value.result,
    solvedAt: value.solvedAt,
    observedAt: value.observedAt,
    aiUsage: value.aiUsage,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    source: "captured",
    ...(value.executionTime ? { executionTime: value.executionTime } : {}),
    ...(value.memoryUsage ? { memoryUsage: value.memoryUsage } : {}),
  };
}

function parseSolutionsEnvelope(value: unknown): readonly DashboardServerSolution[] | null {
  if (
    !isObject(value)
    || value.success !== true
    || value.error !== null
    || typeof value.requestId !== "string"
    || !value.requestId.trim()
    || !Array.isArray(value.data)
  ) return null;
  const records = value.data.map(parseDashboardServerSolution);
  return records.every((record): record is DashboardServerSolution => record !== null)
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
