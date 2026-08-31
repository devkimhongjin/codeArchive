import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityPermalink, CommunitySharing, SharedDiscussion } from "./Community";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { CommunityUnavailableError, type CommunityClient, type SharedSolution } from "./communityClient";
import { invalidateCommunity } from "./communityLifecycle";
import type { DashboardSolution } from "./archiveTypes";
const owner = "11111111-1111-4111-8111-111111111111";
const peerId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-31T00:00:00Z";
const own: DashboardSolution = { id: owner, platform: "SWEA", problemNumber: "1206", title: "View", code: "my code", language: "Java", updatedAt: now, solvedAt: now, source: "captured" };
const peer: SharedSolution = { id: peerId, platform: "SWEA", problemNumber: "1206", title: "View", code: "private-until-qualified", language: "Java", publishedAt: now, author: { id: peerId, login: "peer" }, likeCount: 0, commentCount: 0, liked: false };
const comment = { id: "33333333-3333-4333-8333-333333333333", author: { id: owner, login: "me" }, body: "<script>steal()</script>", createdAt: now, updatedAt: now };
function client(): CommunityClient {
  let shared = false, liked = false;
  return {
    sharing: vi.fn(async () => ({ publicSolution: shared, canPublish: true, eligible: shared })),
    publish: vi.fn(async (_id, value) => { shared = value; return { publicSolution: value, canPublish: true, eligible: value }; }),
    peers: vi.fn(async () => ({ items: [peer], hasMore: false })),
    detail: vi.fn(async () => ({ ...peer, liked, likeCount: liked ? 1 : 0 })),
    comments: vi.fn(async () => ({ items: [comment], hasMore: false })),
    addComment: vi.fn(async (_id, body) => ({ ...comment, body })),
    editComment: vi.fn(async (_id, _cid, body) => ({ ...comment, body })),
    deleteComment: vi.fn(async () => {}), like: vi.fn(async (_id, value) => { liked = value; }), report: vi.fn(async () => {}),
  };
}
const expired = vi.fn();
afterEach(() => { globalThis.history.replaceState(null, "", "/"); vi.useRealTimers(); });
async function openAndPublish() {
  fireEvent.click(screen.getByRole("button", { name: "공개 설정 확인" }));
  const publish = await screen.findByRole("button", { name: "이 풀이 공개하기" });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /공개할 코드/ })); fireEvent.click(publish);
  await waitFor(() => expect(screen.getByRole("button", { name: "다른 풀이 보기" })).toBeEnabled());
}
describe("qualified peer community", () => {
  it("does not fetch peers or publish on selection and requires separate consent", async () => {
    const api = client(); render(<CommunitySharing solution={own} account={owner} client={api} onSessionExpired={expired} />);
    expect(api.sharing).not.toHaveBeenCalled(); expect(api.peers).not.toHaveBeenCalled(); expect(api.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "다른 풀이 보기" })).toBeDisabled();
    await openAndPublish(); expect(api.publish).toHaveBeenCalledWith(owner, true, expect.any(AbortSignal));
    expect(api.peers).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "다른 풀이 보기" }));
    fireEvent.click(await screen.findByRole("button", { name: /@peer · Java/ }));
    expect(await screen.findByText(peer.code!)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내 코드와 비교" })); expect(screen.getByText("my code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "비공개로 전환" }));
    await waitFor(() => expect(screen.queryByText(peer.code!)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "다른 풀이 보기" })).toBeDisabled());
  });
  it("blocks manual/legacy records without attempting publication", async () => {
    const api = client(); api.sharing = vi.fn(async () => ({ publicSolution: false, canPublish: false, eligible: false }));
    render(<CommunitySharing solution={own} account={owner} client={api} onSessionExpired={expired} />);
    fireEvent.click(screen.getByRole("button", { name: "공개 설정 확인" }));
    expect(await screen.findByText(/성공 수집 출처를 확인할 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 풀이 공개하기" })).not.toBeInTheDocument(); expect(api.publish).not.toHaveBeenCalled();
  });
  it("renders comment HTML as text and supports own edits, delete confirmation and unlike", async () => {
    const api = client(); render(<SharedDiscussion id={peerId} account={owner} client={api} onSessionExpired={expired} />);
    expect(await screen.findByText(comment.body)).toBeInTheDocument(); expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "댓글 수정" }));
    fireEvent.change(screen.getByLabelText("댓글 수정 내용"), { target: { value: "updated" } }); fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(api.editComment).toHaveBeenCalledWith(peerId, comment.id, "updated", expect.any(AbortSignal)));
    fireEvent.click(await screen.findByRole("button", { name: "댓글 삭제" })); expect(api.deleteComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" })); await waitFor(() => expect(api.deleteComment).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "좋아요" }));
    fireEvent.click(await screen.findByRole("button", { name: "좋아요 취소" }));
    await waitFor(() => expect(api.like).toHaveBeenLastCalledWith(peerId, false, expect.any(AbortSignal)));
  });
  it("does not show edit/delete actions for someone else's comment", async () => {
    const api = client(); render(<SharedDiscussion id={peerId} account="other" client={api} onSessionExpired={expired} />);
    await screen.findByText(comment.body); expect(screen.queryByRole("button", { name: "댓글 수정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "댓글 삭제" })).not.toBeInTheDocument();
  });
  it("adds comments once and submits an explicit report", async () => {
    const api = client(); render(<SharedDiscussion id={peerId} account={owner} client={api} onSessionExpired={expired} />);
    await screen.findByText(comment.body); fireEvent.change(screen.getByLabelText("새 댓글"), { target: { value: "great explanation" } });
    fireEvent.click(screen.getByRole("button", { name: "댓글 등록" })); await waitFor(() => expect(api.addComment).toHaveBeenCalledTimes(1));
    await screen.findByLabelText("신고 사유"); fireEvent.change(screen.getByLabelText("신고 사유"), { target: { value: "SPAM" } });
    fireEvent.click(screen.getByRole("button", { name: "신고 접수" })); await waitFor(() => expect(api.report).toHaveBeenCalledWith(peerId, "SPAM", expect.any(AbortSignal)));
  });
  it("clears code and comments on revoked access, showing failure rather than an empty list", async () => {
    const api = client(); render(<SharedDiscussion id={peerId} account={owner} client={api} onSessionExpired={expired} />);
    await screen.findByText(peer.code!); api.detail = vi.fn().mockRejectedValue(new CommunityUnavailableError());
    act(() => invalidateCommunity());
    expect(screen.queryByText(peer.code!)).not.toBeInTheDocument(); expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("접근할 수 없습니다");
    expect(screen.queryByText("아직 댓글이 없습니다.")).not.toBeInTheDocument();
  });
  it("ignores a late detail and a late mutation after unmount/account change", async () => {
    const api = client(); let resolve!: (value: SharedSolution) => void; let signal: AbortSignal | undefined;
    api.detail = vi.fn((_id, value) => { signal = value; return new Promise((done) => { resolve = done; }); });
    const view = render(<SharedDiscussion key={owner} id={peerId} account={owner} client={api} onSessionExpired={expired} />);
    view.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => resolve(peer)); expect(screen.queryByText(peer.code!)).not.toBeInTheDocument();
    const second = client(); let finish!: () => void; let mutationSignal: AbortSignal | undefined;
    second.like = vi.fn((_id, _value, value) => { mutationSignal = value; return new Promise<void>((done) => { finish = done; }); });
    const mounted = render(<SharedDiscussion id={peerId} account={owner} client={second} onSessionExpired={expired} />);
    fireEvent.click(await screen.findByRole("button", { name: "좋아요" })); mounted.unmount(); expect(mutationSignal?.aborted).toBe(true);
    await act(async () => finish()); expect(screen.queryByText(peer.code!)).not.toBeInTheDocument();
  });
  it("expires the session after a community 401", async () => {
    const api = client(); const expire = vi.fn(); api.detail = vi.fn().mockRejectedValue(new ArchiveSessionExpiredError());
    render(<SharedDiscussion id={peerId} account={owner} client={api} onSessionExpired={expire} />);
    await waitFor(() => expect(expire).toHaveBeenCalledOnce()); expect(screen.queryByText(peer.code!)).not.toBeInTheDocument();
  });
  it("does not fetch a permalink while signed out", async () => {
    globalThis.history.replaceState(null, "", `/#community=${peerId}`);
    const api = client(); const view = render(<CommunityPermalink account="" client={api} onSessionExpired={expired} />);
    expect(screen.getByText(/로그인하고 같은 문제/)).toBeInTheDocument(); expect(api.detail).not.toHaveBeenCalled();
    view.rerender(<CommunityPermalink account={owner} client={api} onSessionExpired={expired} />);
    await screen.findByText(peer.code!); view.rerender(<CommunityPermalink account="" client={api} onSessionExpired={expired} />);
    expect(screen.queryByText(peer.code!)).not.toBeInTheDocument();
  });
});
