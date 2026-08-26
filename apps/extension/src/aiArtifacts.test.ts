import { describe, expect, it, vi } from "vitest";
import { codeArchiveAiApi } from "./aiArtifacts";
import type { AuthenticatedCodeArchiveSession } from "./solutionSync";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function session(request: AuthenticatedCodeArchiveSession["request"]): AuthenticatedCodeArchiveSession {
  return { request };
}

describe("CodeArchive AI artifact client", () => {
  it("creates with type only and never sends code/user ownership fields", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/v1/solutions/server-solution/ai-artifacts");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ type: "CODE_REVIEW" });
      return json({ success: true, data: { id: "a1", solutionId: "server-solution", type: "CODE_REVIEW", content: "review", provider: "fake", model: "fake", createdAt: "2026-08-26T00:00:00Z" } });
    });
    const artifact = await codeArchiveAiApi.create(session(request), "server-solution", "CODE_REVIEW");
    expect(artifact.content).toBe("review");
  });

  it("uses authenticated list/get routes", async () => {
    const request = vi.fn(async (path: string) => {
      if (path === "/api/v1/solutions/s1/ai-artifacts") return json({ success: true, data: [] });
      if (path === "/api/v1/ai-artifacts/a1") return json({ success: true, data: { id: "a1", solutionId: "s1", type: "COMMENTED_CODE", content: "commented", createdAt: "2026-08-26T00:00:00Z" } });
      throw new Error("unexpected path");
    });
    await expect(codeArchiveAiApi.list(session(request), "s1")).resolves.toEqual([]);
    await expect(codeArchiveAiApi.get(session(request), "a1")).resolves.toMatchObject({ type: "COMMENTED_CODE", content: "commented" });
  });

  it("maps 429 and 401 to safe typed failures", async () => {
    await expect(codeArchiveAiApi.create(session(vi.fn(async () => json({ success: false, data: null, error: { code: "RATE_LIMITED" } }, 429))), "s1", "APPROACH_DESIGN"))
      .rejects.toMatchObject({ kind: "rate_limit" });
    await expect(codeArchiveAiApi.list(session(vi.fn(async () => json({ success: false, data: null }, 401))), "s1"))
      .rejects.toMatchObject({ kind: "auth" });
  });
});
