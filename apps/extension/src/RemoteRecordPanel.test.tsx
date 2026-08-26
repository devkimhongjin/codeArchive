import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteRecordPanel } from "./RemoteRecordPanel";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";
import type { CodeArchiveAuthService } from "./authSession";
import type { CodeArchiveAiApi } from "./aiArtifacts";

const base: SolutionRecord = {
  id: "local-1", platform: "SWEA", problemNumber: "1234", title: "Test", language: "Java", code: "class Solution {}",
  solvedAt: "2026-08-26", aiUsage: "unknown", createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z",
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-26T00:00:00Z" },
};

function repository(record: SolutionRecord): SolutionRepository {
  let current = record;
  return {
    create: vi.fn(), list: vi.fn(async () => [current]), getById: vi.fn(async () => current), update: vi.fn(), delete: vi.fn(),
    setSyncMetadata: vi.fn(async (_id, sync) => { current = { ...current, sync }; return current; }),
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

  it("treats another user's synced metadata as local-only for the current account", async () => {
    const record = { ...base, sync: { state: "synced" as const, userKey: "user-a", serverSolutionId: "server-a", lastAttemptAt: "2026-08-26T00:00:00Z", lastSyncedAt: "2026-08-26T00:00:01Z" } };
    const service = auth({ restore: vi.fn(async () => ({ status: "authenticated" as const, user: { id: "user-b", githubLogin: "other", displayName: "Other", avatarUrl: null }, expiresAt: "2026-08-27T00:00:00Z" })) as any });
    render(<RemoteRecordPanel record={record} repository={repository(record)} authService={service} aiApi={aiApi} />);
    expect(await screen.findByText("동기화 상태: 로컬 전용")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 동기화" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "코드 리뷰" })).toBeDisabled();
  });

  it("enables the three AI actions only for a current-user synced record and keeps original code untouched", async () => {
    const record = { ...base, sync: { state: "synced" as const, userKey: "user-a", serverSolutionId: "server-a", lastAttemptAt: "2026-08-26T00:00:00Z", lastSyncedAt: "2026-08-26T00:00:01Z" } };
    const session = { request: vi.fn() };
    const service = auth({
      restore: vi.fn(async () => ({ status: "authenticated" as const, user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null }, expiresAt: "2026-08-27T00:00:00Z" })) as any,
      getAuthenticatedSession: vi.fn(async () => session) as any,
    });
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
});
