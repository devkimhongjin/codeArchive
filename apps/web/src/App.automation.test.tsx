import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardAuthClient, SessionDiscovery } from "./authClient";
import { mainApiDurableAutomationClient, type DurableAutomationProfile } from "./durableAutomationClient";
import { setDurableAutomationProfile } from "./durableAutomationState";
import type { DashboardExtensionConnection, ExtensionConnectionState } from "./extensionConnection";
import type { CodeArchiveRelayPairingInfoResponse, ExtensionToDashboardAutomationMessage } from "../../../packages/shared-types/src";
import { githubTestClient } from "./githubTestFixtures";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const session: SessionDiscovery = { status: "authenticated", user: { id: ID, githubLogin: "fixture", displayName: "Fixture", avatarUrl: "" } };

function auth(): DashboardAuthClient {
  return { discoverSession: async () => session, login: vi.fn(), logout: vi.fn(async (before) => { await before?.(); return true; }) };
}

afterEach(() => {
  setDurableAutomationProfile(null);
  vi.restoreAllMocks();
});

function bridge() {
  let control: ((message: ExtensionToDashboardAutomationMessage) => void) | undefined;
  const published: unknown[] = [];
  const startSyncSession = vi.fn(async () => true);
  const endSyncSession = vi.fn(async () => undefined);
  const extensionConnection: DashboardExtensionConnection = {
    start(onState, _onCaptureChanged, onAutomationMessage) {
      control = onAutomationMessage;
      onState({ status: "connected", summary: { protocolVersion: 1, pendingCount: 0, allCount: 0, revision: 1 } });
      return () => undefined;
    },
    publishAutomationState(state) { published.push(state); return true; },
    startSyncSession,
    endSyncSession,
  };
  return { extensionConnection, published, startSyncSession, endSyncSession, send(message: ExtensionToDashboardAutomationMessage) { control?.(message); } };
}

describe("Dashboard automation authority", () => {
  it("does not reactivate remembered AUTO_SYNC after a plain Extension reconnect", async () => {
    let setState: ((state: ExtensionConnectionState) => void) | undefined;
    const published: unknown[] = [];
    const startSyncSession = vi.fn(async () => true);
    const extensionConnection: DashboardExtensionConnection = {
      start(onState, _onCaptureChanged, _onAutomationMessage) {
        setState = onState;
        onState({ status: "connected", summary: { protocolVersion: 1, pendingCount: 1, allCount: 1, revision: 1 } });
        return () => undefined;
      },
      publishAutomationState(state) { published.push(state); return true; },
      startSyncSession,
      endSyncSession: vi.fn(async () => undefined),
    };

    render(<App
      dataSource={{ listSolutions: async () => [] }}
      authClient={auth()}
      extensionConnection={extensionConnection}
      consentStore={{ read: () => true, write: vi.fn() }}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
    />);

    await waitFor(() => expect(published.at(-1)).toMatchObject({ autoSyncEnabled: true, connectionAvailable: true }));
    expect(startSyncSession).toHaveBeenCalledTimes(1);

    await act(async () => setState?.({ status: "unavailable" }));
    await waitFor(() => expect(published.at(-1)).toMatchObject({ autoSyncEnabled: false, connectionAvailable: false }));

    await act(async () => setState?.({ status: "connected", summary: { protocolVersion: 1, pendingCount: 1, allCount: 1, revision: 2 } }));
    await waitFor(() => expect(published.at(-1)).toMatchObject({ autoSyncEnabled: false, connectionAvailable: true }));
    expect(startSyncSession).toHaveBeenCalledTimes(1);
  });

  it("keeps page AUTO_SYNC stopped after reconnect without revoking durable GitHub intent", async () => {
    const deviceId = "device_identity_1234";
    const profile: DurableAutomationProfile = {
      userId: ID,
      deviceId,
      generation: 4,
      sourceTransferEnabled: true,
      githubAutoCommitEnabled: false,
      ownershipMode: "DURABLE_SERVER",
      targetGeneration: 0,
      target: null,
      automaticTransferConsent: true,
      visibilityRiskConsent: false,
      publicUploadConsent: false,
      githubEnabledAt: null,
      version: 7,
      updatedAt: "2026-09-06T00:00:00.000Z",
      sessionBindingFingerprint: `sb1_${"a".repeat(43)}`,
    };
    const pairing: CodeArchiveRelayPairingInfoResponse = {
      type: "CODEARCHIVE_RELAY_PAIRING_INFO",
      phase: "INFO",
      protocolVersion: 1,
      deviceId,
      publicKey: "public-key",
      state: "ACTIVE",
      grantId: "grant-identity-1234",
      generation: profile.generation,
      expiresAt: "2099-09-06T00:00:00.000Z",
    };
    vi.spyOn(mainApiDurableAutomationClient, "profile").mockResolvedValue(profile);
    vi.spyOn(mainApiDurableAutomationClient, "update").mockRejectedValue(new Error("unexpected durable update"));
    setDurableAutomationProfile(profile);

    let setState: ((state: ExtensionConnectionState) => void) | undefined;
    const published: unknown[] = [];
    const extensionConnection: DashboardExtensionConnection = {
      start(onState, _onCaptureChanged, _onAutomationMessage) {
        setState = onState;
        onState({ status: "connected", summary: { protocolVersion: 1, pendingCount: 0, allCount: 0, revision: 1 } });
        return () => undefined;
      },
      publishAutomationState(state) { published.push(state); return true; },
      startSyncSession: vi.fn(async () => true),
      endSyncSession: vi.fn(async () => undefined),
      relayPairingInfo: vi.fn(async () => pairing),
      relaySignChallenge: vi.fn(async () => null),
      relayProvisionGrant: vi.fn(async () => null),
      relayConfirmRevoke: vi.fn(async () => null),
    };

    render(<App
      dataSource={{ listSolutions: async () => [] }}
      authClient={auth()}
      extensionConnection={extensionConnection}
      consentStore={{ read: () => true, write: vi.fn() }}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
    />);

    await waitFor(() => expect(published.at(-1)).toMatchObject({ autoSyncEnabled: true, connectionAvailable: true }));
    await act(async () => setState?.({ status: "unavailable" }));
    await waitFor(() => expect(published.at(-1)).toMatchObject({ autoSyncEnabled: true, connectionAvailable: false }));
    await act(async () => setState?.({ status: "connected", summary: { protocolVersion: 1, pendingCount: 0, allCount: 0, revision: 2 } }));
    await waitFor(() => expect(published.at(-1)).toMatchObject({ autoSyncEnabled: true, connectionAvailable: true }));
    expect(extensionConnection.relayConfirmRevoke).not.toHaveBeenCalled();
  });

  it("keeps durable relay automation authoritative across Dashboard pagehide", async () => {
    const fixture = bridge();
    const extensionConnection: DashboardExtensionConnection = {
      ...fixture.extensionConnection,
      relayPairingInfo: vi.fn(async () => null),
      relaySignChallenge: vi.fn(async () => null),
      relayProvisionGrant: vi.fn(async () => null),
      relayConfirmRevoke: vi.fn(async () => null),
    };
    const profile: DurableAutomationProfile = {
      userId: ID,
      deviceId: "device_identity_1234",
      generation: 4,
      sourceTransferEnabled: true,
      githubAutoCommitEnabled: false,
      ownershipMode: "DURABLE_SERVER",
      targetGeneration: 0,
      target: null,
      automaticTransferConsent: true,
      visibilityRiskConsent: false,
      publicUploadConsent: false,
      githubEnabledAt: null,
      version: 7,
      updatedAt: "2026-09-06T00:00:00.000Z",
      sessionBindingFingerprint: `sb1_${"a".repeat(43)}`,
    };
    setDurableAutomationProfile(profile);

    render(<App
      dataSource={{ listSolutions: async () => [] }}
      authClient={auth()}
      extensionConnection={extensionConnection}
      consentStore={{ read: () => true, write: vi.fn() }}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
    />);

    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: true, connectionAvailable: true }));
    const publishedBeforePagehide = fixture.published.length;
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    await act(async () => { await Promise.resolve(); });
    const publishedAfterPagehide = fixture.published.slice(publishedBeforePagehide);

    expect(fixture.startSyncSession).not.toHaveBeenCalled();
    expect(fixture.endSyncSession).not.toHaveBeenCalled();
    expect(publishedAfterPagehide).not.toContainEqual(expect.objectContaining({ autoSyncEnabled: false }));
    expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: true, connectionAvailable: true });
    expect(fixture.published.at(-1)).not.toMatchObject({ autoSyncEnabled: false });
  });

  it("publishes fresh sanitized automation state after a manual reconnect", async () => {
    let attempts = 0;
    const published: unknown[] = [];
    const extensionConnection: DashboardExtensionConnection = {
      start(onState) {
        attempts += 1;
        onState(attempts === 1
          ? { status: "unavailable" }
          : { status: "connected", summary: { protocolVersion: 1, pendingCount: 2, allCount: 3, revision: 2 } });
        return () => undefined;
      },
      publishAutomationState(state) { published.push(state); return true; },
      startSyncSession: vi.fn(async () => true),
      endSyncSession: vi.fn(async () => undefined),
    };
    render(<App dataSource={{ listSolutions: async () => [] }} authClient={auth()} extensionConnection={extensionConnection} consentStore={{ read: () => false, write: vi.fn() }} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" />);
    fireEvent.click(await screen.findByRole("button", { name: "다시 확인" }));
    await screen.findByText("Extension 연결됨");
    await waitFor(() => expect(published.at(-1)).toMatchObject({ authenticated: true, connectionAvailable: true, autoSyncEnabled: false, githubAutoCommitEnabled: false, errorCode: null }));
    expect(attempts).toBe(2);
  });

  it("answers state requests with only the sanitized authoritative shape and rejects ON without consent", async () => {
    const fixture = bridge();
    render(<App dataSource={{ listSolutions: async () => [] }} authClient={auth()} extensionConnection={fixture.extensionConnection} consentStore={{ read: () => false, write: vi.fn() }} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" />);
    await screen.findByRole("checkbox", { name: /자동 동기화/ });
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: 1 }));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: true }));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: false, authenticated: true, connectionAvailable: true, errorCode: "AUTO_SYNC_CONSENT_REQUIRED" }));
    expect(Object.keys(fixture.published.at(-1) as object)).toEqual(["protocolVersion", "autoSyncEnabled", "githubAutoCommitEnabled", "githubTargetConfigured", "authenticated", "connectionAvailable", "errorCode"]);
    expect(JSON.stringify(fixture.published)).not.toMatch(/accountId|userId|repositoryId|installationId|branch|folder|token|cookie|oauth|source|title|problemUrl/i);
    expect(fixture.startSyncSession).not.toHaveBeenCalled();
  });

  it("stops both automation paths on multiple-dashboard safety stop and does not resume implicitly", async () => {
    const fixture = bridge();
    const store = { read: () => false, write: vi.fn() };
    render(<App dataSource={{ listSolutions: async () => [] }} authClient={auth()} extensionConnection={fixture.extensionConnection} consentStore={store} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" />);
    const consent = await screen.findByRole("checkbox", { name: /자동 동기화/ });
    fireEvent.click(consent);
    await waitFor(() => expect(fixture.startSyncSession).toHaveBeenCalledTimes(1));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "MULTIPLE_DASHBOARD_TABS" }));
    await waitFor(() => expect(fixture.endSyncSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: false, githubAutoCommitEnabled: false, errorCode: "MULTIPLE_DASHBOARD_TABS" }));
    expect(fixture.startSyncSession).toHaveBeenCalledTimes(1);
  });

  it("clears the multi-tab safety state only after an explicit valid AUTO_SYNC re-enable", async () => {
    const fixture = bridge();
    const store = { read: () => false, write: vi.fn() };
    render(<App dataSource={{ listSolutions: async () => [] }} authClient={auth()} extensionConnection={fixture.extensionConnection} consentStore={store} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(fixture.startSyncSession).toHaveBeenCalledTimes(1));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "MULTIPLE_DASHBOARD_TABS" }));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: false, githubAutoCommitEnabled: false, errorCode: "MULTIPLE_DASHBOARD_TABS" }));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: true }));
    await waitFor(() => expect(fixture.startSyncSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: true, githubAutoCommitEnabled: false, errorCode: null }));
    expect(fixture.startSyncSession).toHaveBeenCalledTimes(2);
  });

  it("turns automatic mode off without revoking source-transfer consent", async () => {
    const fixture = bridge();
    const write = vi.fn();
    render(<App dataSource={{ listSolutions: async () => [] }} authClient={auth()} extensionConnection={fixture.extensionConnection} consentStore={{ read: () => false, write }} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(fixture.startSyncSession).toHaveBeenCalledTimes(1));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: false }));
    await waitFor(() => expect(fixture.endSyncSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: false, githubAutoCommitEnabled: false }));
    expect(write).toHaveBeenCalledWith(true, expect.any(String));
    expect(write).not.toHaveBeenCalledWith(false, undefined);
    expect(fixture.startSyncSession).toHaveBeenCalledTimes(1);
  });

  it("reports AUTO_SYNC OFF distinctly while valid source-transfer consent remains", async () => {
    const fixture = bridge();
    const read = vi.fn(() => true);
    const write = vi.fn();
    const githubClient = githubTestClient();
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      authClient={auth()}
      extensionConnection={fixture.extensionConnection}
      consentStore={{ read, write }}
      githubClient={githubClient}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);

    const consent = await screen.findByRole("checkbox", { name: /자동 동기화/ });
    await waitFor(() => expect(consent).toBeChecked());
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: true }));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: true, authenticated: true, connectionAvailable: true }));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: false }));
    await waitFor(() => expect(fixture.endSyncSession).toHaveBeenCalledWith("session-a"));
    await waitFor(() => expect(fixture.published.at(-1)).toMatchObject({ autoSyncEnabled: false, githubAutoCommitEnabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "GitHub 저장소 연결 확인" }));
    expect(await screen.findByRole("status")).toHaveTextContent("자동 동기화가 OFF 상태입니다. 자동 동기화를 먼저 켠 뒤 GitHub 자동 커밋을 활성화하세요.");
    expect(screen.queryByText("자동 커밋을 켜기 위한 Dashboard·Extension·온라인 상태 조건을 확인하세요.")).not.toBeInTheDocument();
    expect(consent).toBeChecked();
    expect(read).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalledWith(false, expect.anything());
    expect(githubClient.autoEnable).not.toHaveBeenCalled();
  });
});
