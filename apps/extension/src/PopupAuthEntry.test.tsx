import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Popup } from "./PopupView";
import type { CodeArchiveAuthService } from "./authSession";
import type { SolutionRepository } from "./solutionRepository";

function emptyRepository(): SolutionRepository {
  return {
    create: vi.fn(),
    list: vi.fn(async () => []),
    getById: vi.fn(async () => undefined),
    update: vi.fn(),
    delete: vi.fn(),
    setSyncMetadata: vi.fn(),
  };
}

function authService(): CodeArchiveAuthService {
  return {
    isConfigured: () => true,
    restore: vi.fn(async () => ({ status: "signed_out" as const })),
    login: vi.fn(async () => ({
      status: "authenticated" as const,
      user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null },
      expiresAt: "2026-08-27T00:00:00Z",
    })),
    logout: vi.fn(async () => undefined),
    getAuthenticatedSession: vi.fn(async () => null),
  } as unknown as CodeArchiveAuthService;
}

describe("Popup auth entry", () => {
  it("guides signed-out users to Dashboard without offering Extension login", async () => {
    const service = authService();
    render(<Popup repository={emptyRepository()} authService={service} />);

    expect(await screen.findByText(/로그인은 위의 전체 풀이 보기로 Dashboard에서/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전체 풀이 보기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 풀이 등록" })).toBeInTheDocument();
    expect(screen.getByText("아직 저장된 풀이가 없습니다.")).toBeInTheDocument();
    expect(service.restore).toHaveBeenCalledOnce();
    expect(service.login).not.toHaveBeenCalled();
  });

  it("preserves logout for an existing legacy session without offering sign-in again", async () => {
    const service = authService();
    service.restore = vi.fn(async () => ({
      status: "authenticated" as const,
      user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null },
      expiresAt: "2026-08-27T00:00:00Z",
    }));
    render(<Popup repository={emptyRepository()} authService={service} />);

    expect(await screen.findByText("@tester")).toBeInTheDocument();
    expect(service.login).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(service.logout).toHaveBeenCalledOnce());
    expect(await screen.findByText(/로그인은 위의 전체 풀이 보기로 Dashboard에서/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
  });

  it("keeps Dashboard guidance after legacy session restore fails", async () => {
    const service = authService();
    service.restore = vi.fn(async () => { throw new Error("unavailable"); });
    render(<Popup repository={emptyRepository()} authService={service} />);

    await waitFor(() => expect(service.restore).toHaveBeenCalledOnce());
    expect(screen.getByText(/로그인은 위의 전체 풀이 보기로 Dashboard에서/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
    expect(service.login).not.toHaveBeenCalled();
  });

  it("does not reintroduce sign-in when opening local popup detail", async () => {
    const service = authService();
    const record = { id: "record-1", platform: "SWEA", problemNumber: "1000", title: "Local test", language: "Java", code: "class Main {}", solvedAt: null, aiUsage: "unknown" as const, createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z" };
    const repository = emptyRepository();
    repository.list = vi.fn(async () => [record]);
    repository.getById = vi.fn(async () => record);
    render(<Popup repository={repository} authService={service} />);
    fireEvent.click(await screen.findByRole("button", { name: /Local test/ }));
    fireEvent.click(screen.getByRole("button", { name: /수동저장/ }));
    expect(await screen.findByText(/로그인과 서버 관리는 목록의 전체 풀이 보기로 Dashboard에서/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GitHub로 로그인" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source" })).toBeInTheDocument();
    expect(service.login).not.toHaveBeenCalled();
  });
});
