import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import type { DashboardAuthClient } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";
import { mainApiGitHubClient } from "./githubClient";
import { AI_TASK_LABELS, AiArtifactRequestError, type AiArtifact, type AiTaskType, type DashboardAiArtifactClient } from "./aiArtifactClient";

const solution: DashboardServerSolution = {
  id: "11111111-1111-4111-8111-111111111111", clientRecordId: "capture-one", platform: "SWEA", problemNumber: "1206", title: "Synthetic solution", language: "JAVA",
  code: "synthetic unchanged source", result: "ACCEPTED", solvedAt: null, observedAt: null, aiUsage: "unknown", createdAt: "2026-08-30T01:00:00Z", updatedAt: "2026-08-30T01:00:00Z", source: "captured",
};
const second = { ...solution, id: "22222222-2222-4222-8222-222222222222", problemNumber: "1207", code: "second source", language: "PYTHON" };
const artifact: AiArtifact = { id: "33333333-3333-4333-8333-333333333333", solutionId: solution.id, type: "CODE_REVIEW", content: "<script>synthetic()</script>", provider: "fake", model: "fake-model", createdAt: "2026-08-31T00:00:00Z" };
function auth(login = "account-a"): DashboardAuthClient {
  const id = login === "account-a" ? "550e8400-e29b-41d4-a716-446655440000" : login === "account-b" ? "650e8400-e29b-41d4-a716-446655440000" : login;
  return { discoverSession: async () => ({ status: "authenticated", user: { id, githubLogin: login, displayName: login, avatarUrl: "" } }), login: vi.fn(), logout: vi.fn(async (before) => { await before?.(); return true; }) };
}
function bridge(): DashboardExtensionConnection {
  return { start(onState) { onState({ status: "unavailable" }); return () => {}; }, startSyncSession: vi.fn(), endSyncSession: vi.fn(), beginImport: vi.fn(), readPendingPage: vi.fn(), ackImported: vi.fn() };
}
function client(): DashboardAiArtifactClient { return { list: vi.fn(async () => []), create: vi.fn(async (_id, type) => ({ ...artifact, type })) }; }

beforeEach(() => {
  vi.spyOn(mainApiGitHubClient, "autoStatus").mockResolvedValue({
    runId: null, state: "OFF", target: null, enabledAt: null, leaseUntil: null, errorCode: null, lastResult: null,
  });
});
afterEach(() => vi.restoreAllMocks());

async function open(type: AiTaskType = "CODE_REVIEW") {
  fireEvent.click(await screen.findByRole("button", { name: "AI 도우미 열기" }));
  await waitFor(() => expect(screen.getByRole("button", { name: AI_TASK_LABELS[type] })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: AI_TASK_LABELS[type] }));
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "전송 동의 후 AI 실행" })); }

describe("Dashboard AI artifacts", () => {
  it("never requests on selection alone and requires per-action consent with keyboard cancellation", async () => {
    const ai = client(); const extension = bridge();
    render(<App authClient={auth()} extensionConnection={extension} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={ai} />);
    await screen.findByRole("button", { name: "AI 도우미 열기" });
    expect(ai.list).not.toHaveBeenCalled(); expect(ai.create).not.toHaveBeenCalled();
    await open();
    expect(screen.getByRole("button", { name: "AI 요청 취소" })).toHaveFocus();
    expect(screen.getByText(/서버에 저장된 코드와 문제 메타데이터/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "AI 요청 취소" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "AI 요청 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "코드 리뷰" })).toHaveFocus();
    expect(ai.create).not.toHaveBeenCalled(); expect(extension.readPendingPage).not.toHaveBeenCalled();
  });
  it.each<AiTaskType>(["APPROACH_DESIGN", "COMMENTED_CODE", "CODE_REVIEW"])("creates %s only after consent, retains original and renders inert fake output", async (type) => {
    const ai = client();
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={ai} />);
    await open(type); submit();
    expect(await screen.findByText(artifact.content)).toBeInTheDocument();
    expect(document.querySelector(".ai-content script")).toBeNull();
    expect(screen.getByText(/테스트용 결과 · 실제 AI 분석 아님/)).toBeInTheDocument();
    expect(screen.getByText(solution.code)).toBeInTheDocument();
    expect(ai.create).toHaveBeenCalledExactlyOnceWith(solution.id, type, expect.any(AbortSignal));
    expect(screen.queryByRole("region", { name: "AI 요청 확인" })).not.toBeInTheDocument();
  });
  it("loads stored output without generation and keeps it on refresh failure", async () => {
    const ai = client(); ai.list = vi.fn().mockResolvedValueOnce([artifact]).mockRejectedValueOnce(new Error("private"));
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={ai} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI 도우미 열기" }));
    await screen.findByText(artifact.content);
    fireEvent.click(screen.getByRole("button", { name: "AI 결과 새로고침" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 결과를 불러오지 못했습니다");
    expect(screen.getByText(artifact.content)).toBeInTheDocument(); expect(ai.create).not.toHaveBeenCalled();
  });
  it("blocks duplicate generation, editing, and deletion while pending", async () => {
    const ai = client(); let finish!: (value: AiArtifact) => void;
    ai.create = vi.fn(() => new Promise<AiArtifact>((resolve) => { finish = resolve; }));
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={ai} />);
    await open(); submit();
    fireEvent.click(screen.getByRole("button", { name: "AI 생성 중..." }));
    expect(ai.create).toHaveBeenCalledTimes(1);
    for (const name of ["수정", "서버에서 삭제", "AI 요청 취소"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    await act(async () => finish(artifact));
    await waitFor(() => expect(screen.getByRole("button", { name: "수정" })).toBeEnabled());
  });
  it.each([new Error("private source/token detail"), new AiArtifactRequestError("rate_limit")])("requires a refresh after failed generation without automatic retry %#", async (error) => {
    const ai = client(); ai.create = vi.fn().mockRejectedValue(error);
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={ai} />);
    await open(); submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(error instanceof AiArtifactRequestError ? "한도" : "서버에서 계속 처리될 수");
    expect(alert).not.toHaveTextContent("private");
    expect(screen.getByRole("button", { name: "코드 리뷰" })).toBeDisabled();
    expect(ai.create).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "AI 결과 새로고침" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "코드 리뷰" })).toBeEnabled());
    expect(ai.create).toHaveBeenCalledTimes(1);
  });
  it.each(["list", "create"] as const)("expires the active session on %s 401", async (operation) => {
    const ai = client(); ai[operation] = vi.fn().mockRejectedValue(new ArchiveSessionExpiredError());
    const write = vi.fn();
    render(<App authClient={auth()} extensionConnection={bridge()} consentStore={{ read: () => false, write }} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={ai} />);
    if (operation === "create") { await open(); submit(); }
    else fireEvent.click(await screen.findByRole("button", { name: "AI 도우미 열기" }));
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(screen.queryByText(solution.code)).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledWith(false, undefined);
  });
  it.each(["solution", "account", "logout"] as const)("aborts generation and ignores late output after %s change", async (change) => {
    const ai = client(); let finish!: (value: AiArtifact) => void; let signal: AbortSignal | undefined;
    ai.create = vi.fn((_id, _type, requestSignal) => { signal = requestSignal; return new Promise<AiArtifact>((resolve) => { finish = resolve; }); });
    const props = { extensionConnection: bridge(), dataSource: { listSolutions: async () => [solution, second] }, aiArtifactClient: ai };
    const view = render(<App {...props} authClient={auth()} />);
    await open(); submit();
    if (change === "solution") fireEvent.click(screen.getByRole("button", { name: /PYTHON/ }));
    else if (change === "account") { view.rerender(<App {...props} authClient={auth("account-b")} />); await screen.findByText("@account-b"); }
    else { fireEvent.click(screen.getByRole("button", { name: "로그아웃" })); await screen.findByRole("button", { name: "GitHub로 로그인" }); }
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(artifact));
    expect(screen.queryByText(artifact.content)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 결과를 별도로 저장했습니다/)).not.toBeInTheDocument();
  });
  it("ignores a stale list 401 after account change", async () => {
    const ai = client(); let fail!: (cause: Error) => void; let signal: AbortSignal | undefined;
    ai.list = vi.fn((_id, requestSignal) => { signal = requestSignal; return new Promise<readonly AiArtifact[]>((_resolve, reject) => { fail = reject; }); });
    const props = { extensionConnection: bridge(), dataSource: { listSolutions: async () => [solution] }, aiArtifactClient: ai };
    const view = render(<App {...props} authClient={auth()} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI 도우미 열기" }));
    view.rerender(<App {...props} authClient={auth("account-b")} />); await screen.findByText("@account-b");
    expect(signal?.aborted).toBe(true);
    await act(async () => fail(new ArchiveSessionExpiredError()));
    expect(screen.getByText("@account-b")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
  });
  it("does not offer AI while editing a solution", async () => {
    render(<App authClient={auth()} extensionConnection={bridge()} dataSource={{ listSolutions: async () => [solution] }} aiArtifactClient={client()} />);
    fireEvent.click(await screen.findByRole("button", { name: "수정" }));
    expect(screen.getByRole("button", { name: "AI 도우미 열기" })).toBeDisabled();
  });
});
