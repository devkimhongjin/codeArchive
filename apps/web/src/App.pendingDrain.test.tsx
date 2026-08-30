import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CodeArchiveCaptureChangedEvent } from "../../../packages/shared-types/src";
import { App } from "./App";
import type { AutoSyncConsentStore } from "./autoSyncSession";
import type { DashboardAuthClient } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const authenticated: DashboardAuthClient = {
  discoverSession: async () => ({
    status: "authenticated",
    user: { githubLogin: "octocat", displayName: "Octo Cat", avatarUrl: "" },
  }),
  login: vi.fn(),
  logout: vi.fn(async (hook) => { await hook?.(); return true; }),
};

const signedOut: DashboardAuthClient = {
  discoverSession: async () => ({ status: "signed_out" }),
  login: vi.fn(),
  logout: vi.fn(async () => true),
};

function consent(value: boolean): AutoSyncConsentStore {
  return { read: () => value, write: vi.fn() };
}

function pendingConnection(pendingCount = 1) {
  let onChanged: ((event: CodeArchiveCaptureChangedEvent) => void) | undefined;
  const beginImport = vi.fn(async () => "cap-a");
  const connection: DashboardExtensionConnection = {
    start(onState, captureChanged) {
      onChanged = captureChanged;
      onState({
        status: "connected",
        summary: { protocolVersion: 1, pendingCount, allCount: pendingCount, revision: 1 },
      });
      return () => undefined;
    },
    startSyncSession: vi.fn(async () => true),
    endSyncSession: vi.fn(async () => undefined),
    beginImport,
    readPendingPage: vi.fn(async () => ({
      ok: true,
      data: { protocolVersion: 1, scope: "pending", records: [], revision: 1 },
    })),
    ackImported: vi.fn(async () => true),
  };
  return {
    connection,
    beginImport,
    captureChanged(event: CodeArchiveCaptureChangedEvent) { onChanged?.(event); },
  };
}

describe("Dashboard automatic pending catch-up", () => {
  it("eligible initial pending summary triggers IMPORT_BEGIN after session START", async () => {
    const bridge = pendingConnection(2);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={bridge.connection}
      authClient={authenticated}
      consentStore={consent(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
      importBatchIdGenerator={() => "batch-a"}
    />);

    await screen.findByText("Octo Cat");
    fireEvent.click(screen.getByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(bridge.beginImport).toHaveBeenCalledWith("session-a"));
    expect(bridge.beginImport).toHaveBeenCalledTimes(1);
  });

  it("signed-out stored consent never requests source", async () => {
    const bridge = pendingConnection(2);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={bridge.connection}
      authClient={signedOut}
      consentStore={consent(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    await screen.findByRole("button", { name: "GitHub로 로그인" });
    await waitFor(() => expect(bridge.beginImport).not.toHaveBeenCalled());
  });

  it("metadata-only CAPTURE_CHANGED schedules catch-up without waiting for another summary", async () => {
    const bridge = pendingConnection(1);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={bridge.connection}
      authClient={authenticated}
      consentStore={consent(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(bridge.beginImport).toHaveBeenCalledTimes(1));

    bridge.captureChanged({
      type: "CODEARCHIVE_CAPTURE_CHANGED",
      protocolVersion: 1,
      pendingCount: 1,
      revision: 2,
    });
    await waitFor(() => expect(bridge.beginImport).toHaveBeenCalledTimes(2));
  });
});
