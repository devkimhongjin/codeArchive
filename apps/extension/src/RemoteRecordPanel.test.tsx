import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteRecordPanel } from "./RemoteRecordPanel";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";
import type { CodeArchiveAuthService } from "./authSession";
import { AiApiError, type CodeArchiveAiApi } from "./aiArtifacts";

const base: SolutionRecord = {
  id: "local-1", platform: "SWEA", problemNumber: "1234", title: "Test", language: "Java", code: "class Solution {}",
  solvedAt: "2026-08-26", aiUsage: "unknown", createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z",
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-26T00:00:00Z" },
};

function repository(record: SolutionRecord): SolutionRepository {
  let current = record;
  return {
    create: vi.fn(), list: vi.fn(async () => [current]), getById: vi.fn(async () => current), update: vi.fn(), delete: vi.fn(),
    setSyncMetadata: vi.fn(async (_id, sync) => {
      current = { ...current };
      if (sync) current.sync = sync;
      else delete current.sync;
      return current;
    }),
  };
}

function auth(overrides: Partial<CodeArchiveAuthService> = {}): CodeArchiveAuthService {
  return {
    isConfigured: () => true,
    restore: vi.fn(async () => ({ status: "signed_out" as const })),
    login: vi.fn(async () => ({ status: "authenticated" as const, user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null }, expiresAt: "2026-08-27T00:00:00Z" })),
    logout: vi.fn(async () => undefined),
    getAuthenticatedSession: vi.fn(async () => null),
    ...overrides,
  } as unknown as CodeArchiveAuthService;
}

const aiApi: CodeArchiveAiApi = {
  create: vi.fn(), list: vi.fn(async () => []), get: vi.fn(),
};

function syncedRecord(): SolutionRecord {
  return { ...base, sync: { state: "synced", userKey: "user-a", serverSolutionId: "server-a", lastAttemptAt: "2026-08-26T00:00:00Z", lastSyncedAt: "2026-08-26T00:00:01Z" } };
}

function authenticatedService() {
  const session = { request: vi.fn() };
  return {
    session,
    service: auth({
      restore: vi.fn(async () => ({ status: "authenticated" as const, user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null }, expiresAt: "2026-08-27T00:00:00Z" })) as any,
      getAuthenticatedSession: vi.fn(async () => session) as any,
    }),
  };
}

describe("RemoteRecordPanel", () => {
  it("never launches interactive login during initial restore", async () => {
    const service = auth();
    render(<RemoteRecordPanel record={base} repository={repository(base)} authService={service} aiApi={aiApi} />);
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    expect(service.login).not.toHaveBeenCalled();
  });

  it("requires an explicit login click", async () => {
    const service = auth();
    render(<RemoteRecordPanel record={base} repository={repository(base)} authService={service} aiApi={aiApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "GitHub로 로그인" }));
    await waitFor(() => expect(service.login).toHaveBeenCalledOnce());
    expect(await screen.findByText("@tester")).toBeInTheDocument();
  });

  it("logs out explicitly without mutating the local solution repository", async () => {
    const record = syncedRecord();
    const repo = repository(record);
    const { service } = authenticatedService();
    render(<RemoteRecordPanel record={record} repository={repo} authService={service} aiApi={aiApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(service.logout).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("removes stale synced ownership when the authenticated account changes", async () => {
    const record = syncedRecord();
    const repo = repository(record);
    const onRecordChange = vi.fn();
    const service = auth({ restore: vi.fn(async () => ({ status: "authenticated" as const, user: { id: "user-b", githubLogin: "other", displayName: "Other", avatarUrl: null }, expiresAt: "2026-08-27T00:00:00Z" })) as any });
    render(<RemoteRecordPanel record={record} repository={repo} authService={service} aiApi={aiApi} onRecordChange={onRecordChange} />);
    await waitFor(() => expect(repo.setSyncMetadata).toHaveBeenCalledWith("local-1", undefined));
    await waitFor(() => expect(onRecordChange).toHaveBeenCalledOnce());
    const reconciled = onRecordChange.mock.calls[0][0] as SolutionRecord;
    expect(reconciled.id).toBe("local-1");
    expect(reconciled.sync).toBeUndefined();
    expect(await screen.findByText("동기화 상태: 로컬 전용")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 동기화" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "코드 리뷰" })).toBeDisabled();
  });

  it("enables the three AI actions only for a current-user synced record and keeps original code untouched", async () => {
    const record = syncedRecord();
    const { service, session } = authenticatedService();
    const api: CodeArchiveAiApi = {
      list: vi.fn(async () => []), get: vi.fn(),
      create: vi.fn(async (_session, solutionId, type) => ({ id: "artifact-1", solutionId, type, content: "generated", createdAt: "2026-08-26T00:01:00Z" })),
    };
    render(<RemoteRecordPanel record={record} repository={repository(record)} authService={service} aiApi={api} />);
    for (const label of ["접근 및 설계 작성", "코드 주석 추가", "코드 리뷰"]) expect(await screen.findByRole("button", { name: label })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "코드 주석 추가" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(session, "server-a", "COMMENTED_CODE"));
    expect(record.code).toBe("class Solution {}");
    expect(await screen.findByText("generated")).toBeInTheDocument();
  });

  it("shows a safe 429 message", async () => {
    const record = syncedRecord();
    const { service } = authenticatedService();
    const api: CodeArchiveAiApi = { list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(async () => { throw new AiApiError("rate_limit"); }) };
    render(<RemoteRecordPanel record={record} repository={repository(record)} authService={service} aiApi={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "코드 리뷰" }));
    expect(await screen.findByText("오늘의 AI 요청 한도를 초과했습니다. 나중에 다시 시도해주세요.")).toBeInTheDocument();
  });

  it("shows a safe provider/backend failure message", async () => {
    const record = syncedRecord();
    const { service } = authenticatedService();
    const api: CodeArchiveAiApi = { list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(async () => { throw new AiApiError("unavailable"); }) };
    render(<RemoteRecordPanel record={record} repository={repository(record)} authService={service} aiApi={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "접근 및 설계 작성" }));
    expect(await screen.findByText("AI 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.")).toBeInTheDocument();
  });

  it("allows only one POST attempt while an AI action is pending", async () => {
    const record = syncedRecord();
    const { service } = authenticatedService();
    let resolveCreate!: (artifact: any) => void;
    const pending = new Promise<any>((resolve) => { resolveCreate = resolve; });
    const create = vi.fn(() => pending);
    const api: CodeArchiveAiApi = { list: vi.fn(async () => []), get: vi.fn(), create };
    render(<RemoteRecordPanel record={record} repository={repository(record)} authService={service} aiApi={api} />);
    const button = await screen.findByRole("button", { name: "코드 리뷰" });
    fireEvent.click(button);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "생성 중..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "생성 중..." }));
    expect(create).toHaveBeenCalledTimes(1);
    resolveCreate({ id: "artifact-1", solutionId: "server-a", type: "CODE_REVIEW", content: "done", createdAt: "2026-08-26T00:01:00Z" });
    expect(await screen.findByText("done")).toBeInTheDocument();
  });
});
