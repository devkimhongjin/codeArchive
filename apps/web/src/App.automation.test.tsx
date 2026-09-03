import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardAuthClient, SessionDiscovery } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";
import type { ExtensionToDashboardAutomationMessage } from "../../../packages/shared-types/src";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const session: SessionDiscovery = { status: "authenticated", user: { id: ID, githubLogin: "fixture", displayName: "Fixture", avatarUrl: "" } };

function auth(): DashboardAuthClient {
  return { discoverSession: async () => session, login: vi.fn(), logout: vi.fn(async (before) => { await before?.(); return true; }) };
}

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

  it("invalidates the active sync session and remembered opt-in on explicit auto-sync OFF", async () => {
    const fixture = bridge();
    const write = vi.fn();
    render(<App dataSource={{ listSolutions: async () => [] }} authClient={auth()} extensionConnection={fixture.extensionConnection} consentStore={{ read: () => false, write }} dashboardOrigin="https://codearchive-dashboard-beta.onrender.com" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(fixture.startSyncSession).toHaveBeenCalledTimes(1));
    await act(async () => fixture.send({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: false }));
    await waitFor(() => expect(fixture.endSyncSession).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(false, undefined);
    expect(fixture.startSyncSession).toHaveBeenCalledTimes(1);
  });
});
