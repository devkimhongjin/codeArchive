import { describe, expect, it, vi } from "vitest";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { CommunityRateLimitError, CommunityRevisionError, CommunityUnavailableError, createCommunityClient } from "./communityClient";
const id = "11111111-1111-4111-8111-111111111111";
const sharing = { publicSolution: false, canPublish: true, eligible: false };
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data, error: null, requestId: "test" }), { status: 200 });
describe("community request boundary", () => {
  it("uses cookie session, no-store and separate explicit publication payload", async () => {
    const fetcher = vi.fn(async () => ok(sharing)); const api = createCommunityClient(fetcher);
    await api.sharing(id); await api.publish(id, { publicSolution: true, expectedUpdatedAt: "2026-08-31T00:00:00Z" });
    expect(fetcher).toHaveBeenNthCalledWith(1, expect.stringContaining(`/sharing/${id}`), expect.objectContaining({ credentials: "include", cache: "no-store", method: "GET" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ method: "POST", body: '{"publicSolution":true,"expectedUpdatedAt":"2026-08-31T00:00:00Z"}' }));
  });
  it.each([[401, ArchiveSessionExpiredError], [403, CommunityUnavailableError], [404, CommunityUnavailableError], [409, CommunityRevisionError], [429, CommunityRateLimitError]] as const)("maps %s without exposing response bodies", async (status, kind) => {
    const api = createCommunityClient(vi.fn(async () => new Response("secret body", { status })));
    await expect(api.sharing(id)).rejects.toBeInstanceOf(kind);
  });
  it("rejects malformed identity, flags, pages and null detail code", async () => {
    const fetcher = vi.fn(async () => ok({ ...sharing, eligible: "yes" })); const api = createCommunityClient(fetcher);
    expect(() => api.sharing("../private")).toThrow(); expect(fetcher).not.toHaveBeenCalled();
    await expect(api.sharing(id)).rejects.toThrow("Invalid community response");
    fetcher.mockImplementation(async () => ok({ items: [], hasMore: 0 }));
    await expect(api.peers(id, "Java", 0)).rejects.toThrow();
    fetcher.mockImplementation(async () => ok({ id, platform: "SWEA", problemNumber: "1", title: "x", language: "Java", code: null, publishedAt: "2026-08-31T00:00:00Z", author: { id, login: "test" }, likeCount: 0, commentCount: 0, liked: false }));
    await expect(api.detail(id)).rejects.toThrow();
  });
  it("propagates cancellation without following a mutation with an automatic retry", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))); });
    });
    const abort = new AbortController(); const pending = createCommunityClient(fetcher).like(id, true, abort.signal);
    abort.abort(); await expect(pending).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
