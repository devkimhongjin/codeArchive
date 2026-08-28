import type { AuthenticatedCodeArchiveSession } from "./solutionSync";

export type AiArtifactType = "APPROACH_DESIGN" | "COMMENTED_CODE" | "CODE_REVIEW";

export interface AiArtifact {
  id: string;
  solutionId: string;
  type: AiArtifactType;
  content: string;
  createdAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error?: { code?: string } | null;
}

export type AiApiErrorKind = "auth" | "rate_limit" | "unavailable";

export class AiApiError extends Error {
  constructor(public readonly kind: AiApiErrorKind) {
    super(kind);
  }
}

export interface CodeArchiveAiApi {
  create(session: AuthenticatedCodeArchiveSession, solutionId: string, type: AiArtifactType): Promise<AiArtifact>;
  list(session: AuthenticatedCodeArchiveSession, solutionId: string): Promise<AiArtifact[]>;
  get(session: AuthenticatedCodeArchiveSession, artifactId: string): Promise<AiArtifact>;
}

async function parse<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null;
  try {
    body = await response.json() as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  if (response.status === 401) throw new AiApiError("auth");
  if (response.status === 429 || body?.error?.code === "RATE_LIMITED") throw new AiApiError("rate_limit");
  if (!response.ok || !body?.success || body.data == null) throw new AiApiError("unavailable");
  return body.data;
}

export const codeArchiveAiApi: CodeArchiveAiApi = {
  async create(session, solutionId, type) {
    return parse<AiArtifact>(await session.request(
      `/api/v1/solutions/${encodeURIComponent(solutionId)}/ai-artifacts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      },
    ));
  },
  async list(session, solutionId) {
    return parse<AiArtifact[]>(await session.request(
      `/api/v1/solutions/${encodeURIComponent(solutionId)}/ai-artifacts`,
      { method: "GET" },
    ));
  },
  async get(session, artifactId) {
    return parse<AiArtifact>(await session.request(
      `/api/v1/ai-artifacts/${encodeURIComponent(artifactId)}`,
      { method: "GET" },
    ));
  },
};
