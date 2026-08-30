import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { MAIN_API_ORIGIN } from "./authClient";
import { withRequestDeadline } from "./requestDeadline";

export interface DashboardSolutionDeleteClient {
  deleteSolution(id: string, signal?: AbortSignal): Promise<void>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDeleteSuccess(value: unknown): boolean {
  return isObject(value)
    && value.success === true
    && value.error === null
    && typeof value.requestId === "string"
    && value.requestId.trim().length > 0
    && isObject(value.data)
    && value.data.deleted === true;
}

export function createMainApiSolutionDeleteClient(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): DashboardSolutionDeleteClient {
  return {
    async deleteSolution(id, signal) {
      // DELETE takes the stable server UUID, never the capture/clientRecordId.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error("solution delete id invalid");
      }
      if (signal?.aborted) throw new Error("solution delete cancelled");
      await withRequestDeadline(async (requestSignal) => {
        const response = await fetcher(`${MAIN_API_ORIGIN}/api/v1/solutions/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "include",
          signal: requestSignal,
        });
        if (response.status === 401) throw new ArchiveSessionExpiredError("session expired");
        if (!response.ok) throw new Error("solution delete failed");
        if (!isDeleteSuccess(await response.json())) throw new Error("solution delete response invalid");
      }, signal);
    },
  };
}

export const mainApiSolutionDeleteClient = createMainApiSolutionDeleteClient();
