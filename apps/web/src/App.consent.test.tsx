import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ACCOUNT_CONSENT_KEY, createAutoSyncConsentStore, deriveAccountBinding } from "./accountConsent";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardAuthClient, SessionDiscovery } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655440001";
const source = { listSolutions: async () => [] };
const session = (id: string | undefined = ID, githubLogin = "octocat"): SessionDiscovery => ({ status: "authenticated", user: { id, githubLogin, displayName: "", avatarUrl: "" } });
function auth(discoverSession: () => Promise<SessionDiscovery> = async () => session()): DashboardAuthClient {
  return { discoverSession, login: vi.fn(), logout: vi.fn(async (before) => { await before?.(); return true; }) };
}
function setupProps() {
  const start = vi.fn(async () => true);
  const end = vi.fn(async () => undefined);
  const connection: DashboardExtensionConnection = {
    start(onState) { onState({ status: "connected", summary: { protocolVersion: 1, pendingCount: 0, allCount: 0, revision: 1 } }); return () => {}; },
    startSyncSession: start, endSyncSession: end,
  };
  return { dataSource: source, extensionConnection: connection, consentStore: createAutoSyncConsentStore(localStorage), dashboardOrigin: "https://codearchive-dashboard-beta.onrender.com", start, end };
}
async function remember() {
  createAutoSyncConsentStore(localStorage).write(true, await deriveAccountBinding(ID));
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe("remembered account consent integration", () => {
  it("remounts with remembered consent only after fresh /me, even when GitHub login is renamed", async () => {
    const props = setupProps();
    const first = render(<App {...props} authClient={auth()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(localStorage.getItem(ACCOUNT_CONSENT_KEY)).not.toBeNull());
    first.unmount();
    let finish!: (result: SessionDiscovery) => void;
    const next = setupProps();
    render(<App {...next} authClient={auth(() => new Promise((resolve) => { finish = resolve; }))} />);
    expect(next.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => finish(session(ID, "renamed")));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).toBeChecked());
    expect(next.start).toHaveBeenCalledTimes(1);
  });

  it.each([OTHER_ID, undefined])("never restores for different/missing immutable ID: %s", async (id) => {
    await remember();
    const props = setupProps();
    const result: SessionDiscovery = { status: "authenticated", user: { id, githubLogin: "octocat", displayName: "", avatarUrl: "" } };
    render(<App {...props} authClient={auth(async () => result)} />);
    expect(await screen.findByRole("checkbox", { name: /자동 동기화/ })).not.toBeChecked();
    await waitFor(() => expect(localStorage.getItem(ACCOUNT_CONSENT_KEY)).toBeNull());
    expect(props.start).not.toHaveBeenCalled();
  });

  it("failed network logout still clears remembered consent", async () => {
    await remember();
    const props = setupProps();
    const client = auth();
    client.logout = vi.fn(async (before) => { await before?.(); return false; });
    render(<App {...props} authClient={client} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(localStorage.getItem(ACCOUNT_CONSENT_KEY)).toBeNull();
    await screen.findByText("로그인 상태를 확인할 수 없습니다.");
    expect(props.end).toHaveBeenCalled();
  });

  it.each(["discovery", "archive"])("clears consent on confirmed %s session expiry", async (kind) => {
    await remember();
    const props = setupProps();
    render(<App {...props}
      authClient={kind === "discovery" ? auth(async () => ({ status: "signed_out" })) : auth()}
      dataSource={kind === "archive" ? { listSolutions: async () => { throw new ArchiveSessionExpiredError(); } } : source}
    />);
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    expect(localStorage.getItem(ACCOUNT_CONSENT_KEY)).toBeNull();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps transient unavailable ineligible without discarding a remembered preference", async () => {
    await remember();
    const props = setupProps();
    render(<App {...props} authClient={auth(async () => ({ status: "unavailable" }))} />);
    await screen.findByText("로그인 상태를 확인할 수 없습니다.");
    expect(props.start).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCOUNT_CONSENT_KEY)).not.toBeNull();
  });

  it("cross-tab revocation stops sync and revalidates auth before allowing another opt-in", async () => {
    await remember();
    const props = setupProps();
    let finish!: (result: SessionDiscovery) => void;
    const discover = vi.fn().mockResolvedValueOnce(session()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App {...props} authClient={auth(discover)} />);
    await waitFor(() => expect(props.start).toHaveBeenCalledTimes(1));
    act(() => {
      localStorage.removeItem(ACCOUNT_CONSENT_KEY);
      globalThis.dispatchEvent(new StorageEvent("storage", { key: ACCOUNT_CONSENT_KEY }));
    });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("로그인 상태 확인 중")).toBeInTheDocument();
    await waitFor(() => expect(props.end).toHaveBeenCalled());
    await act(async () => finish(session(OTHER_ID)));
    expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).not.toBeChecked();
    expect(props.start).toHaveBeenCalledTimes(1);
  });
});
