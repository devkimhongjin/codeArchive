import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { MAIN_API_ORIGIN } from "./authClient";
import { API_REQUEST_TIMEOUT_MS, withRequestDeadline } from "./requestDeadline";

export const AI_TASK_LABELS = {
  APPROACH_DESIGN: "접근 방법 설계",
  COMMENTED_CODE: "주석 코드 생성",
  CODE_REVIEW: "코드 리뷰",
} as const;
export type AiTaskType = keyof typeof AI_TASK_LABELS;
// Analysis may take up to 90 seconds on the beta's cold-starting service.
export const AI_CREATE_TIMEOUT_MS = 120_000;

export interface AiArtifact {
  id: string;
  solutionId: string;
  type: AiTaskType;
  content: string;
  provider: string;
  model: string;
  createdAt: string;
}

export interface DashboardAiArtifactClient {
  list(solutionId: string, signal?: AbortSignal): Promise<readonly AiArtifact[]>;
  create(solutionId: string, type: AiTaskType, signal?: AbortSignal): Promise<AiArtifact>;
}

export class AiArtifactRequestError extends Error {
  constructor(readonly kind: "rate_limit" | "unavailable") { super("AI request unavailable"); }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function task(value: unknown): value is AiTaskType {
  return typeof value === "string" && Object.hasOwn(AI_TASK_LABELS, value);
}
function artifact(value: unknown, solutionId: string, type?: AiTaskType): AiArtifact {
  if (!object(value) || !text(value.id) || !uuid.test(value.id)
    || value.solutionId !== solutionId || !task(value.type) || (type && value.type !== type)
    || !text(value.content) || !text(value.provider) || !text(value.model)
    || !text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new AiArtifactRequestError("unavailable");
  }
  return { id: value.id, solutionId, type: value.type, content: value.content,
    provider: value.provider, model: value.model, createdAt: value.createdAt };
}

export function createMainApiAiArtifactClient(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DashboardAiArtifactClient {
  async function request(solutionId: string, type: AiTaskType | undefined, signal?: AbortSignal): Promise<unknown> {
    if (!uuid.test(solutionId) || (type !== undefined && !task(type)) || signal?.aborted) {
      throw new AiArtifactRequestError("unavailable");
    }
    return withRequestDeadline(async (requestSignal) => {
      const response = await fetcher(`${MAIN_API_ORIGIN}/api/v1/solutions/${encodeURIComponent(solutionId)}/ai-artifacts`, {
        method: type ? "POST" : "GET", credentials: "include", signal: requestSignal,
        ...(type ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) } : {}),
      });
      if (response.status === 401) throw new ArchiveSessionExpiredError("session expired");
      if (response.status === 429) throw new AiArtifactRequestError("rate_limit");
      if (!response.ok) throw new AiArtifactRequestError("unavailable");
      const value: unknown = await response.json();
      if (!object(value) || value.success !== true || value.error !== null || !text(value.requestId)) {
        throw new AiArtifactRequestError("unavailable");
      }
      return value.data;
    }, signal, type ? AI_CREATE_TIMEOUT_MS : API_REQUEST_TIMEOUT_MS);
  }
  return {
    async list(solutionId, signal) {
      const data = await request(solutionId, undefined, signal);
      if (!Array.isArray(data)) throw new AiArtifactRequestError("unavailable");
      const records = data.map((value) => artifact(value, solutionId));
      if (new Set(records.map((value) => value.id)).size !== records.length) throw new AiArtifactRequestError("unavailable");
      return records;
    },
    async create(solutionId, type, signal) {
      return artifact(await request(solutionId, type, signal), solutionId, type);
    },
  };
}

export const mainApiAiArtifactClient = createMainApiAiArtifactClient();
