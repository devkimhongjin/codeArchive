import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import type { DashboardAuthClient } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";
import { mainApiGitHubClient } from "./githubClient";
import { createMainApiSolutionDeleteClient, type DashboardSolutionDeleteClient } from "./solutionDeleteClient";

const solution: DashboardServerSolution = {
  id: "11111111-1111-4111-8111-111111111111", clientRecordId: "capture-one",
  platform: "SWEA", problemNumber: "1206", title: "First solution", language: "JAVA",
  code: "synthetic first source", result: "ACCEPTED", solvedAt: null, observedAt: null,
  aiUsage: "unknown", createdAt: "2026-08-30T01:00:00Z", updatedAt: "2026-08-30T01:00:00Z", source: "captured",
};
const second: DashboardServerSolution = {
  ...solution, id: "22222222-2222-4222-8222-222222222222", clientRecordId: "capture-two",
  title: "Second solution", problemNumber: "1207", code: "synthetic second source", language: "PYTHON",
};

function auth(id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): DashboardAuthClient {
  return {
    discoverSession: async () => ({ status: "authenticated", user: { id, githubLogin: "fixture", displayName: "Fixture", avatarUrl: "" } }),
    login: vi.fn(), logout: vi.fn(async (before) => { await before?.(); return true; }),
  };
}

function bridge(): DashboardExtensionConnection {
  return {
    start(onState) { onState({ status: "unavailable" }); return () => undefined; },
    startSyncSession: vi.fn(async () => true), endSyncSession: vi.fn(async () => undefined),
    beginImport: vi.fn(), readPendingPage: vi.fn(), ackImported: vi.fn(),
  };
}

beforeEach(() => {
  vi.spyOn(mainApiGitHubClient, "autoStatus").mockResolvedValue({
    runId: null, state: "OFF", target: null, enabledAt: null, leaseUntil: null, errorCode: null, lastResult: null,
  });
});
afterEach(() => vi.restoreAllMocks());

async function openConfirmation() {
  fireEvent.click(await screen.findByRole("button", { name: "서버에서 삭제" }));
  return screen.getByRole("region", { name: "서버 풀이 삭제 확인" });
}

describe("Dashboard server solution deletion", () => {
  it("requires explicit confirmation, focuses cancel, and cancellation never deletes", async () => {
    const deleteSolution = vi.fn();
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} solutionDeleteClient={{ deleteSolution }} />);
    const confirmation = await openConfirmation();
    expect(within(confirmation).getByText(/로컬 원본과 동기화 확인 기록은 삭제하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제 취소" })).toHaveFocus();
    expect(deleteSolution).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "삭제 취소" }));
    expect(screen.queryByRole("region", { name: "서버 풀이 삭제 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "서버에서 삭제" })).toHaveFocus();
    await openConfirmation();
    fireEvent.keyDown(screen.getByRole("button", { name: "삭제 취소" }), { key: "Escape" });
    expect(deleteSolution).not.toHaveBeenCalled();
  });

  it("blocks duplicate requests and editing, removes only the confirmed record, refreshes, and never touches the bridge", async () => {
    let remote = [solution, second];
    let finish!: () => void;
    const deleteSolution = vi.fn((_id: string, _signal?: AbortSignal) => new Promise<void>((resolve) => { finish = () => { remote = [second]; resolve(); }; }));
    const listSolutions = vi.fn(async () => remote);
    const extension = bridge();
    render(<App authClient={auth()} extensionConnection={extension} dataSource={{ listSolutions }} solutionDeleteClient={{ deleteSolution }} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    expect(screen.getByRole("button", { name: "삭제 중..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "삭제 중..." }));
    expect(deleteSolution).toHaveBeenCalledExactlyOnceWith(solution.id, expect.any(AbortSignal));
    expect(screen.getByText(solution.code)).toBeInTheDocument();
    await act(async () => finish());
    expect(await screen.findByText(second.code)).toBeInTheDocument();
    expect(screen.queryByText(solution.code)).not.toBeInTheDocument();
    expect(screen.getByText("1건 · 1문제")).toBeInTheDocument();
    expect(screen.getByText(/서버 풀이를 삭제했습니다/)).toBeInTheDocument();
    expect(listSolutions).toHaveBeenCalledTimes(2);
    expect(extension.startSyncSession).not.toHaveBeenCalled();
    expect(extension.beginImport).not.toHaveBeenCalled();
    expect(extension.readPendingPage).not.toHaveBeenCalled();
    expect(extension.ackImported).not.toHaveBeenCalled();
  });

  it("shows the empty archive after deleting the final record", async () => {
    let remote = [solution];
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => remote }} solutionDeleteClient={{ deleteSolution: async () => { remote = []; } }} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    await waitFor(() => expect(screen.getByText("0건 · 0문제")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "서버에서 삭제" })).not.toBeInTheDocument();
    expect(screen.queryByText(solution.code)).not.toBeInTheDocument();
  });

  it.each([404, 500, "malformed"])("preserves the solution on %s and allows explicit refresh", async (result) => {
    const fetcher = vi.fn(async () => result === "malformed"
      ? new Response(JSON.stringify({ success: true, data: { deleted: false }, error: null, requestId: "fixture" }))
      : new Response("sensitive details must not be rendered", { status: Number(result) }));
    const listSolutions = vi.fn(async () => [solution]);
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions }} solutionDeleteClient={createMainApiSolutionDeleteClient(fetcher)} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("삭제 완료를 확인하지 못했습니다");
    expect(screen.queryByText(/sensitive details/)).not.toBeInTheDocument();
    expect(screen.getByText(solution.code)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));
    await waitFor(() => expect(listSolutions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(solution.code)).toBeInTheDocument();
  });

  it("clears the archive and remembered consent on current-session 401", async () => {
    const write = vi.fn();
    render(<App authClient={auth()} extensionConnection={bridge()} consentStore={{ read: () => false, write }} dataSource={{ listSolutions: async () => [solution] }} solutionDeleteClient={{ deleteSolution: async () => { throw new ArchiveSessionExpiredError(); } }} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(screen.queryByText(solution.code)).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledWith(false, undefined);
  });

  it.each(["success", "expired"])("cancels and ignores stale %s after selecting another solution", async (result) => {
    let complete!: () => void;
    let signal: AbortSignal | undefined;
    const client: DashboardSolutionDeleteClient = { deleteSolution: (_id, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve, reject) => { complete = () => result === "success" ? resolve() : reject(new ArchiveSessionExpiredError()); });
    } };
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution, second] }} solutionDeleteClient={client} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    fireEvent.click(screen.getByRole("button", { name: /PYTHON/ }));
    expect(signal?.aborted).toBe(true);
    await act(async () => complete());
    expect(screen.getByText(second.code)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
    expect(screen.queryByText(/서버 풀이를 삭제했습니다/)).not.toBeInTheDocument();
    expect(screen.getByText("2건 · 2문제")).toBeInTheDocument();
  });

  it("aborts on logout and ignores a late success", async () => {
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} solutionDeleteClient={{ deleteSolution: (_id, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => { finish = resolve; });
    } }} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    expect(signal?.aborted).toBe(true);
    await act(async () => finish());
    expect(screen.queryByText(solution.code)).not.toBeInTheDocument();
    expect(screen.queryByText(/서버 풀이를 삭제했습니다/)).not.toBeInTheDocument();
  });

  it("does not offer deletion while editing the record", async () => {
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "수정" }));
    expect(screen.getByRole("button", { name: "서버에서 삭제" })).toBeDisabled();
  });

  it.each(["success", "expired"])("ignores an old account's late %s after switching accounts", async (result) => {
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    const client: DashboardSolutionDeleteClient = { deleteSolution: (_id, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve, reject) => { finish = () => result === "success" ? resolve() : reject(new ArchiveSessionExpiredError()); });
    } };
    const props = { extensionConnection: bridge(), solutionDeleteClient: client };
    const firstSource = { listSolutions: async () => [solution] };
    const view = render(<App {...props} authClient={auth()} dataSource={firstSource} />);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    view.rerender(<App {...props} authClient={auth("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")} dataSource={{ listSolutions: async () => [second] }} />);
    await screen.findByText(second.code);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish());
    expect(screen.getByText(second.code)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
    expect(screen.queryByText(/서버 풀이를 삭제했습니다/)).not.toBeInTheDocument();
  });

  it("ends an active sync session when deletion returns 401", async () => {
    const extension = bridge();
    extension.start = (onState) => {
      onState({ status: "connected", summary: { protocolVersion: 1, pendingCount: 0, allCount: 1, revision: 1 } });
      return () => undefined;
    };
    render(<App authClient={auth()} extensionConnection={extension} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" syncSessionIdGenerator={() => "synthetic-session"} consentStore={{ read: () => false, write() {} }} dataSource={{ listSolutions: async () => [solution] }} solutionDeleteClient={{ deleteSolution: async () => { throw new ArchiveSessionExpiredError(); } }} />);
    await screen.findByText(solution.code);
    fireEvent.click(screen.getByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(extension.startSyncSession).toHaveBeenCalledWith("synthetic-session"));
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    await waitFor(() => expect(extension.endSyncSession).toHaveBeenCalledWith("synthetic-session"));
    expect(extension.beginImport).not.toHaveBeenCalled();
  });
});
