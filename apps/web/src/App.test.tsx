import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardArchiveDataSource } from "./archiveTypes";
import type { AutoSyncConsentStore } from "./autoSyncSession";
import type { DashboardAuthClient, SessionDiscovery } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const records = [
  { id: "one", platform: "SWEA", problemNumber: "1234", title: "중위순회", language: "Java", code: "class Solution {}", solvedAt: "2026-08-27", updatedAt: "2026-08-27T12:00:00.000Z", source: "captured" as const },
  { id: "two", platform: "SWEA", problemNumber: "1954", title: "달팽이 숫자", language: "Python", code: "print('ok')", solvedAt: null, updatedAt: "2026-08-26T12:00:00.000Z", source: "manual" as const },
];

function extensionConnection(
  status: "connected" | "unavailable" = "unavailable",
  startSyncSession = vi.fn(async () => true),
  endSyncSession = vi.fn(async () => undefined),
): DashboardExtensionConnection {
  return {
    start(onState) {
      onState(status === "connected"
        ? { status: "connected", summary: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 7 } }
        : { status: "unavailable" });
      return () => undefined;
    },
    startSyncSession,
    endSyncSession,
  };
}

function consentStore(initial = false): AutoSyncConsentStore & { value: boolean } {
  return {
    value: initial,
    read() { return this.value; },
    write(enabled) { this.value = enabled; },
  };
}

function authClient(discover: () => Promise<SessionDiscovery>): DashboardAuthClient {
  return { discoverSession: discover, login: vi.fn(), logout: vi.fn(async (hook) => { await hook?.(); return true; }) };
}

const signedOutAuth = () => authClient(async () => ({ status: "signed_out" }));
const authenticatedAuth = () => authClient(async () => ({
  status: "authenticated",
  user: { githubLogin: "octocat", displayName: "Octo Cat", avatarUrl: "https://avatars.example/octo.png" },
}));

describe("Dashboard archive shell", () => {
  it("never fetches server records while signed out", async () => {
    const listSolutions = vi.fn(async () => records);
    render(<App dataSource={{ listSolutions }} authClient={signedOutAuth()} extensionConnection={extensionConnection()} />);
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    expect(listSolutions).not.toHaveBeenCalled();
    expect(screen.queryByText("class Solution {}")).not.toBeInTheDocument();
  });

  it("clears detail immediately on logout even while logout is stalled", async () => {
    const client = authenticatedAuth();
    client.logout = () => new Promise(() => undefined);
    render(<App dataSource={{ listSolutions: async () => records }} authClient={client} extensionConnection={extensionConnection()} />);
    await screen.findByText("class Solution {}");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.queryByText("class Solution {}")).not.toBeInTheDocument();
    expect(screen.getByText("0건 · 0문제")).toBeInTheDocument();
  });

  it("ignores old account results and requires fresh consent for a new account", async () => {
    let resolveOld!: (value: typeof records) => void;
    const source = { listSolutions: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue([]) };
    const start = vi.fn(async () => true);
    const connection = extensionConnection("connected", start);
    const store = consentStore(true);
    const props = { dataSource: source, extensionConnection: connection, consentStore: store, dashboardOrigin: "https://codearchive-dashboard-beta.onrender.com" };
    const { rerender } = render(<App {...props} authClient={authenticatedAuth()} />);
    const checkbox = await screen.findByRole("checkbox", { name: /자동 동기화/ });
    expect(checkbox).not.toBeChecked();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const other = authClient(async () => ({ status: "authenticated", user: { githubLogin: "other", displayName: "Other", avatarUrl: "" } }));
    rerender(<App {...props} authClient={other} />);
    await screen.findByText("Other");
    await act(async () => resolveOld(records));
    expect(screen.queryByText("class Solution {}")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).not.toBeChecked();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("retries a failed archive read for the current authenticated account", async () => {
    const source = { listSolutions: vi.fn().mockRejectedValueOnce(new Error("private")).mockResolvedValue(records) };
    render(<App dataSource={source} authClient={authenticatedAuth()} extensionConnection={extensionConnection()} />);
    fireEvent.click(await screen.findByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByText("class Solution {}")).toBeInTheDocument();
  });

  it("shows metadata-only Extension connection status and supports retry", async () => {
    let attempts = 0;
    const connection: DashboardExtensionConnection = {
      start(onState) {
        attempts += 1;
        onState(attempts === 1 ? { status: "unavailable" } : { status: "connected", summary: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 7 } });
        return () => undefined;
      },
      startSyncSession: vi.fn(async () => true),
      endSyncSession: vi.fn(async () => undefined),
    };
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={connection} authClient={signedOutAuth()} />);
    expect(screen.getByText("Extension을 찾을 수 없음")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(await screen.findByText("Extension 연결됨")).toBeInTheDocument();
    expect(screen.getByText("동기화 대기 2건 · 로컬 전체 5건")).toBeInTheDocument();
  });

  it("signed-out state never starts even when stored consent is true", async () => {
    const startSyncSession = vi.fn(async () => true);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", startSyncSession)}
      authClient={signedOutAuth()}
      consentStore={consentStore(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    await waitFor(() => expect(startSyncSession).not.toHaveBeenCalled());
  });

  it("authenticated consent defaults false and auth alone does not start", async () => {
    const startSyncSession = vi.fn(async () => true);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", startSyncSession)}
      authClient={authenticatedAuth()}
      consentStore={consentStore(false)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
    />);
    expect(await screen.findByRole("checkbox", { name: /자동 동기화/ })).not.toBeChecked();
    expect(startSyncSession).not.toHaveBeenCalled();
  });

  it("authenticated explicit consent at exact origin starts once", async () => {
    const startSyncSession = vi.fn(async () => true);
    const store = consentStore(false);
    const { rerender } = render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", startSyncSession)}
      authClient={authenticatedAuth()}
      consentStore={store}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    const checkbox = await screen.findByRole("checkbox", { name: /자동 동기화/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(startSyncSession).toHaveBeenCalledTimes(1));
    expect(startSyncSession).toHaveBeenCalledWith("session-a");
    expect(store.value).toBe(true);

    rerender(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", startSyncSession)}
      authClient={authenticatedAuth()}
      consentStore={store}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    expect(startSyncSession).toHaveBeenCalledTimes(1);
  });

  it("wrong Dashboard origin remains ineligible", async () => {
    const startSyncSession = vi.fn(async () => true);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", startSyncSession)}
      authClient={authenticatedAuth()}
      consentStore={consentStore(true)}
      dashboardOrigin="https://example.com"
    />);
    await screen.findByRole("checkbox", { name: /자동 동기화/ });
    expect(startSyncSession).not.toHaveBeenCalled();
  });

  it("consent off clears persistence immediately and ends the active session", async () => {
    const events: string[] = [];
    const store = consentStore(true);
    store.write = (enabled) => { events.push(`store:${enabled}`); store.value = enabled; };
    const endSyncSession = vi.fn(async (id: string) => { events.push(`end:${id}`); });
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", vi.fn(async () => true), endSyncSession)}
      authClient={authenticatedAuth()}
      consentStore={store}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    const checkbox = await screen.findByRole("checkbox", { name: /자동 동기화/ });
    events.length = 0;
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    fireEvent.click(checkbox);
    await waitFor(() => expect(endSyncSession).toHaveBeenCalledWith("session-a"));
    expect(events).toEqual(["store:true", "store:false", "end:session-a"]);
  });

  it("logout tears down the bridge session before API logout", async () => {
    const events: string[] = [];
    const client: DashboardAuthClient = {
      discoverSession: async () => ({ status: "authenticated", user: { githubLogin: "octocat", displayName: "Octo Cat", avatarUrl: "" } }),
      login: vi.fn(),
      logout: vi.fn(async (beforeApiLogout) => {
        await beforeApiLogout?.();
        events.push("api-logout");
        return true;
      }),
    };
    const endSyncSession = vi.fn(async (id: string) => { events.push(`end:${id}`); });
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={extensionConnection("connected", vi.fn(async () => true), endSyncSession)}
      authClient={client}
      consentStore={consentStore(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    await screen.findByText("Octo Cat");
    fireEvent.click(screen.getByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(events).toEqual(["end:session-a", "api-logout"]);
  });

  it("renders signed-out login and invokes navigation-only auth action", async () => {
    const client = signedOutAuth();
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={extensionConnection()} authClient={client} />);
    const login = await screen.findByRole("button", { name: "GitHub로 로그인" });
    fireEvent.click(login);
    expect(client.login).toHaveBeenCalledTimes(1);
  });

  it("renders retryable auth unavailable state and retries discovery", async () => {
    let attempts = 0;
    const client = authClient(async () => {
      attempts += 1;
      return attempts === 1 ? { status: "unavailable" } : { status: "signed_out" };
    });
    render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={extensionConnection()} authClient={client} />);
    expect(await screen.findByText("로그인 상태를 확인할 수 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("loads archive records through the replaceable data source and selects a detail", async () => {
    const dataSource: DashboardArchiveDataSource = { listSolutions: async () => records };
    render(<App dataSource={dataSource} extensionConnection={extensionConnection()} authClient={authenticatedAuth()} />);
    expect(await screen.findByText("class Solution {}")).toBeInTheDocument();
    expect(screen.getByText("2건 · 2문제")).toBeInTheDocument();
  });

  it("filters the archive without adding routing or global state", async () => {
    const dataSource: DashboardArchiveDataSource = { listSolutions: async () => records };
    render(<App dataSource={dataSource} extensionConnection={extensionConnection()} authClient={authenticatedAuth()} />);
    await screen.findByText("2건 · 2문제");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "1954" } });
    const archiveList = screen.getByLabelText("전체 풀이 목록");
    expect(within(archiveList).getByText("달팽이 숫자")).toBeInTheDocument();
    expect(within(archiveList).queryByText("중위순회")).not.toBeInTheDocument();
    expect(screen.getByText("1건 · 1문제")).toBeInTheDocument();
    expect(within(screen.getByLabelText("풀이 상세")).getByText("달팽이 숫자")).toBeInTheDocument();
  });

  it("renders empty and safe error states", async () => {
    const client = authenticatedAuth();
    const connection = extensionConnection();
    const { rerender } = render(<App dataSource={{ listSolutions: async () => [] }} extensionConnection={connection} authClient={client} />);
    expect(await screen.findByText("아직 표시할 풀이가 없습니다.")).toBeInTheDocument();
    rerender(<App dataSource={{ listSolutions: async () => { throw new Error("secret backend detail"); } }} extensionConnection={connection} authClient={client} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("풀이 목록을 불러오지 못했습니다."));
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret backend detail");
  });
});
