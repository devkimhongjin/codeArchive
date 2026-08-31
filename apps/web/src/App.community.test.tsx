import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardSolution } from "./archiveTypes";
import type { DashboardAuthClient } from "./authClient";
import type { CommunityClient, SharedSolution } from "./communityClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const account = "11111111-1111-4111-8111-111111111111";
const peerId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-31T00:00:00Z";
const records: DashboardSolution[] = ["10", "2"].map((problemNumber, index) => ({
  id: `33333333-3333-4333-8333-33333333333${index}`, platform: "SWEA", problemNumber,
  title: `문제 ${problemNumber}`, language: index ? "Python" : "Java", code: `own-${problemNumber}`,
  updatedAt: now, solvedAt: now, source: "captured",
}));
const peer: SharedSolution = { id: peerId, platform: "SWEA", problemNumber: "10", title: "Peer",
  language: "Java", code: "synthetic-peer-code", author: { id: peerId, login: "peer" },
  publishedAt: now, likeCount: 0, commentCount: 0, liked: false };
function props() {
  const authClient: DashboardAuthClient = {
    discoverSession: vi.fn(async () => ({ status: "authenticated" as const, user: { id: account, githubLogin: "fixture", displayName: "Fixture", avatarUrl: "" } })),
    login: vi.fn(), logout: vi.fn(async () => true),
  };
  const extensionConnection: DashboardExtensionConnection = {
    start: vi.fn((notify) => { notify({ status: "unavailable" }); return () => {}; }),
    startSyncSession: vi.fn(async () => true), endSyncSession: vi.fn(async () => {}),
  };
  const communityClient: CommunityClient = {
    sharing: vi.fn(async () => ({ publicSolution: true, canPublish: true, eligible: true })),
    peers: vi.fn(async () => ({ items: [{ ...peer, code: null }], hasMore: false })),
    detail: vi.fn(async () => peer), comments: vi.fn(async () => ({ items: [], hasMore: false })),
    publish: vi.fn(), addComment: vi.fn(), editComment: vi.fn(), deleteComment: vi.fn(), like: vi.fn(), report: vi.fn(),
  };
  return { authClient, extensionConnection, communityClient, dataSource: { listSolutions: vi.fn(async () => records) },
    consentStore: { read: () => false, write: vi.fn() }, dashboardOrigin: "https://codearchive-dashboard-beta.onrender.com" };
}
afterEach(() => globalThis.history.replaceState(null, "", "/"));
describe("archive and community integration", () => {
  it("aborts the old peer detail when an archive filter selects a different problem", async () => {
    const p = props(); let finish!: (value: SharedSolution) => void; let signal: AbortSignal | undefined;
    p.communityClient.detail = vi.fn((_id, next) => { signal = next; return new Promise<SharedSolution>((resolve) => { finish = resolve; }); });
    render(<App {...p} />); await screen.findByText("2건 · 2문제");
    fireEvent.change(screen.getByRole("combobox", { name: "언어" }), { target: { value: "Java" } });
    expect(screen.getByText("own-10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "공개 설정 확인" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "다른 풀이 보기" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "다른 풀이 보기" }));
    fireEvent.click(await screen.findByRole("button", { name: /@peer · Java/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "언어" }), { target: { value: "Python" } });
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(peer));
    expect(screen.queryByText(peer.code!)).not.toBeInTheDocument();
    expect(screen.getByText("own-2")).toBeInTheDocument();
    expect(p.communityClient.publish).not.toHaveBeenCalled();
    expect(p.extensionConnection.startSyncSession).not.toHaveBeenCalled();
  });

  it("clears a shared permalink immediately on logout without refetching peer code", async () => {
    globalThis.history.replaceState(null, "", `/#community=${peerId}`);
    const p = props(); render(<App {...p} />);
    await screen.findByText(peer.code!);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.queryByText(peer.code!)).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    expect(p.communityClient.detail).toHaveBeenCalledOnce();
  });
});
