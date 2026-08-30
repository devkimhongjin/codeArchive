import { ArchiveSessionExpiredError, parseDashboardServerSolution } from "./archiveDataSource";
import type { DashboardAiUsage, DashboardServerSolution } from "./archiveTypes";
import { MAIN_API_ORIGIN } from "./authClient";
import { withRequestDeadline } from "./requestDeadline";

export interface DashboardSolutionEditInput {
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  executionTime: string;
  memoryUsage: string;
  aiUsage: DashboardAiUsage | null;
}

export interface DashboardSolutionUpdateClient {
  updateSolution(
    original: DashboardServerSolution,
    input: DashboardSolutionEditInput,
    signal?: AbortSignal,
  ): Promise<DashboardServerSolution>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function validateInput(input: DashboardSolutionEditInput): void {
  if (
    !input.platform.trim()
    || !input.problemNumber.trim()
    || !input.title.trim()
    || !input.language.trim()
    || !input.code.trim()
  ) throw new Error("solution edit input invalid");
}

function parseUpdateEnvelope(value: unknown): DashboardServerSolution | null {
  if (
    !isObject(value)
    || value.success !== true
    || value.error !== null
    || typeof value.requestId !== "string"
    || !value.requestId.trim()
  ) return null;
  return parseDashboardServerSolution(value.data);
}

export function createMainApiSolutionUpdateClient(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): DashboardSolutionUpdateClient {
  return {
    async updateSolution(original, input, signal) {
      validateInput(input);
      const url = `${MAIN_API_ORIGIN}/api/v1/solutions/by-client-id/${encodeURIComponent(original.clientRecordId)}`;
      return withRequestDeadline(async (requestSignal) => {
        const response = await fetcher(url, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: input.platform.trim(),
            problemNumber: input.problemNumber.trim(),
            title: input.title.trim(),
            language: input.language.trim(),
            code: input.code,
            result: original.result,
            solvedAt: original.solvedAt,
            observedAt: original.observedAt,
            executionTime: normalizedOptional(input.executionTime),
            memoryUsage: normalizedOptional(input.memoryUsage),
            aiUsage: input.aiUsage,
          }),
          signal: requestSignal,
        });
        if (response.status === 401) throw new ArchiveSessionExpiredError("session expired");
        if (!response.ok) throw new Error("solution update failed");
        const updated = parseUpdateEnvelope(await response.json());
        if (!updated || updated.clientRecordId !== original.clientRecordId) {
          throw new Error("solution update response invalid");
        }
        return updated;
      }, signal);
    },
  };
}

export const mainApiSolutionUpdateClient = createMainApiSolutionUpdateClient();
