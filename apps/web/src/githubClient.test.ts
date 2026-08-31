import { describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "./githubClient";
import { githubTestConfirmation, githubTestOff, githubTestResult } from "./githubTestFixtures";
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data, error: null, requestId: "test" }));
describe("GitHub API adapter", () => {
  it("uses only the authenticated API, no cache, keepalive stop and exact identity binding", async () => {
    const id = githubTestConfirmation.intentId; const fetcher = vi.fn().mockResolvedValue(response({ ...githubTestOff, runId: id }));
    await createGitHubClient(fetcher).autoStop(id);
    expect(fetcher).toHaveBeenCalledWith(`https://codearchive-api.onrender.com/api/v1/integrations/github/auto-commit/${id}/stop`, expect.objectContaining({ method: "POST", credentials: "include", cache: "no-store", keepalive: true, body: "{}" }));
    fetcher.mockResolvedValue(response({ ...githubTestResult, intentId: "33333333-3333-4333-8333-333333333333" }));
    await expect(createGitHubClient(fetcher).result(id)).rejects.toThrow();
  });
  it("rejects unsafe commit URLs, forged success, malformed result and outbound selector injection", async () => {
    for (const value of [{ ...githubTestResult, commitUrl: "javascript:alert(1)" }, { ...githubTestResult, commitUrl: "https://github.com.evil.example/a/b/commit/" + "c".repeat(40) }, { ...githubTestResult, retryAllowed: true }, { ...githubTestResult, commitSha: null }]) {
      await expect(createGitHubClient(vi.fn().mockResolvedValue(response(value))).result(githubTestResult.intentId)).rejects.toThrow();
    }
    const fetcher = vi.fn(); expect(() => createGitHubClient(fetcher).repositories("1/../../evil", 1)).toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("never retries a failed mutation or forwards source text from error bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "GITHUB_UPLOAD_OUTCOME_UNKNOWN", message: "secret source" } }), { status: 409 }));
    await expect(createGitHubClient(fetcher).commit(githubTestResult.intentId, { confirmUpload: true, acknowledgeVisibilityRisk: true, confirmPublicUpload: true })).rejects.toThrow("GitHub request unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
