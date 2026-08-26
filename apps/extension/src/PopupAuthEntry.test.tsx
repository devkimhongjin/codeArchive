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
  it("shows GitHub login on the normal popup even with zero saved solutions", async () => {
    const service = authService();
    render(<Popup repository={emptyRepository()} authService={service} />);

    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(screen.getByText("아직 저장된 풀이가 없습니다.")).toBeInTheDocument();
    expect(service.restore).toHaveBeenCalledOnce();
  });

  it("shows the current account after login and exposes logout using the same auth service", async () => {
    const service = authService();
    render(<Popup repository={emptyRepository()} authService={service} />);

    fireEvent.click(await screen.findByRole("button", { name: "GitHub로 로그인" }));
    expect(await screen.findByText("@tester")).toBeInTheDocument();
    expect(service.login).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(service.logout).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
  });
});
