import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CodeArchiveCaptureChangedEvent } from "../../../packages/shared-types/src";
import { App } from "./App";
import type { AutoSyncConsentStore } from "./autoSyncSession";
import type { DashboardAuthClient } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const pendingRecord = {
  clientRecordId: "one",
  problem: {
    platform: "SWEA" as const,
    platformProblemId: "swea-one",
    problemNumber: "1234",
    title: "중위순회",
    url: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=test",
    tags: [],
  },
  language: "JAVA" as const,
  code: "class Solution {}",
  result: "ACCEPTED" as const,
  submittedAt: "2026-08-28T00:00:00.000Z",
};

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

function pendingConnection(pendingCount = 1, records: readonly typeof pendingRecord[] = []) {
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
      data: { protocolVersion: 1, scope: "pending", records, revision: 1 },
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
  it("manual sync drains current pending records without changing the automation control", async () => {
    const bridge = pendingConnection(1, [pendingRecord]);
    const upsert = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(["one"]);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={bridge.connection}
      authClient={authenticated}
      consentStore={consent(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
      importBatchIdGenerator={() => "batch-a"}
      pendingDrainApiClient={{ upsert }}
    />);

    await screen.findByText("Octo Cat");
    fireEvent.click(screen.getByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
    await waitFor(() => expect(screen.getByText("1건 동기화 완료")).toBeInTheDocument());
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(bridge.connection.ackImported).toHaveBeenCalledWith("cap-a", "batch-a", ["one"]);
    expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).toBeChecked();
  });

  it("manual sync clearly reports empty pending work", async () => {
    const bridge = pendingConnection(0);
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={bridge.connection}
      authClient={authenticated}
      consentStore={consent(true)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
      syncSessionIdGenerator={() => "session-a"}
    />);

    await screen.findByText("Octo Cat");
    fireEvent.click(screen.getByRole("checkbox", { name: /자동 동기화/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "지금 동기화" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
    expect(await screen.findByText("동기화할 로컬 풀이 없음")).toBeInTheDocument();
  });

  it("keeps manual sync disabled with an explicit disconnected reason", async () => {
    const bridge = pendingConnection(2);
    bridge.connection.start = (onState) => {
      onState({ status: "unavailable" });
      return () => undefined;
    };
    render(<App
      dataSource={{ listSolutions: async () => [] }}
      extensionConnection={bridge.connection}
      authClient={authenticated}
      consentStore={consent(false)}
      dashboardOrigin="https://codearchive-dashboard-beta.onrender.com"
    />);

    await screen.findByText("Octo Cat");
    fireEvent.click(screen.getByRole("checkbox", { name: /자동 동기화/ }));
    expect(screen.getByRole("button", { name: "지금 동기화" })).toBeDisabled();
    expect(screen.getByText("Extension 연결 후 동기화할 수 있습니다.")).toBeInTheDocument();
  });

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
