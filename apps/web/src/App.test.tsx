import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardArchiveDataSource } from "./archiveTypes";
import type { DashboardAuthClient, SessionDiscovery } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const records = [
  { id: "one", platform: "SWEA", problemNumber: "1234", title: "중위순회", language: "Java", code: "class Solution {}", solvedAt: "2026-08-27", updatedAt: "2026-08-27T12:00:00.000Z", source: "captured" as const },
  { id: "two", platform: "SWEA", problemNumber: "1954", title: "달팽이 숫자", language: "Python", code: "print('ok')", solvedAt: null, updatedAt: "2026-08-26T12:00:00.000Z", source: "manual" as const },
];

const unavailableExtension: DashboardExtensionConnection = {
  start(onState) { onState({ status: "unavailable" }); return () => undefined; },
};

function authClient(discover: () => Promise<SessionDiscovery>): DashboardAuthClient {
  return { discoverSession: discover, login: vi.fn(), logout: vi.fn(async () => true) };
}

const signedOutAuth = () => authClient(async () => ({ status: "signed_out" }));

describe("Dashboard archive shell", () => {
  it("shows metadata-only Extension connection status and supports retry", async () => {
    let attempts = 0;
    const extensionConnection: DashboardExtensionConnection = {
      start(onState) {
        attempts += 1;
        onState(attempts === 1 ? { status: "unavailable" } : { status: "connected", summary: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 7 } });
        return () => undefined;
      },
    };
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={extensionConnection} authClient={signedOutAuth()} />);
    expect(screen.getByText("Extension을 찾을 수 없음")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(await screen.findByText("Extension 연결됨")).toBeInTheDocument();
    expect(screen.getByText("동기화 대기 2건 · 로컬 전체 5건")).toBeInTheDocument();
  });

  it("renders signed-out login and invokes navigation-only auth action", async () => {
    const client = signedOutAuth();
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={unavailableExtension} authClient={client} />);
    const login = await screen.findByRole("button", { name: "GitHub로 로그인" });
    fireEvent.click(login);
    expect(client.login).toHaveBeenCalledTimes(1);
  });

  it("renders authenticated safe account fields and logs out to signed out", async () => {
    const logout = vi.fn(async () => true);
    const client: DashboardAuthClient = {
      discoverSession: async () => ({ status: "authenticated", user: { githubLogin: "octocat", displayName: "Octo Cat", avatarUrl: "https://avatars.example/octo.png" } }),
      login: vi.fn(),
      logout,
    };
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={unavailableExtension} authClient={client} />);
    expect(await screen.findByText("Octo Cat")).toBeInTheDocument();
    expect(screen.getByText("@octocat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("renders retryable auth unavailable state and retries discovery", async () => {
    let attempts = 0;
    const client = authClient(async () => {
      attempts += 1;
      return attempts === 1 ? { status: "unavailable" } : { status: "signed_out" };
    });
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={unavailableExtension} authClient={client} />);
    expect(await screen.findByText("로그인 상태를 확인할 수 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("loads archive records through the replaceable data source and selects a detail", async () => {
    const dataSource: DashboardArchiveDataSource = { listSolutions: async () => records };
    render(<App dataSource={dataSource} extensionConnection={unavailableExtension} authClient={signedOutAuth()} />);
    expect(screen.getByText("풀이 목록을 불러오는 중입니다.")).toBeInTheDocument();
    expect(await screen.findByText("class Solution {}")).toBeInTheDocument();
    expect(screen.getByText("2건 · 2문제")).toBeInTheDocument();
  });

  it("filters the archive without adding routing or global state", async () => {
    const dataSource: DashboardArchiveDataSource = { listSolutions: async () => records };
    render(<App dataSource={dataSource} extensionConnection={unavailableExtension} authClient={signedOutAuth()} />);
    await screen.findByText("2건 · 2문제");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "1954" } });
    const archiveList = screen.getByLabelText("전체 풀이 목록");
    expect(within(archiveList).getByText("달팽이 숫자")).toBeInTheDocument();
    expect(within(archiveList).queryByText("중위순회")).not.toBeInTheDocument();
    expect(screen.getByText("1건 · 1문제")).toBeInTheDocument();
    expect(within(screen.getByLabelText("풀이 상세")).getByText("달팽이 숫자")).toBeInTheDocument();
  });

  it("renders empty and safe error states", async () => {
    const client = signedOutAuth();
    const { rerender } = render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={unavailableExtension} authClient={client} />);
    expect(await screen.findByText("아직 표시할 풀이가 없습니다.")).toBeInTheDocument();
    rerender(<App dataSource={{ listSolutions: async () => { throw new Error("secret backend detail"); } }} extensionConnection={unavailableExtension} authClient={client} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("풀이 목록을 불러오지 못했습니다."));
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret backend detail");
  });
});
