import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import type { DashboardAuthClient } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";
import type { DashboardSolutionUpdateClient } from "./solutionUpdateClient";

const solution: DashboardServerSolution = {
  id: "server-1",
  clientRecordId: "capture-1",
  platform: "SWEA",
  problemNumber: "1206",
  title: "View",
  language: "JAVA",
  code: "class Main {}",
  result: "ACCEPTED",
  solvedAt: "2026-08-30T01:00:00Z",
  observedAt: "2026-08-30T01:00:01Z",
  executionTime: "100",
  memoryUsage: "200",
  aiUsage: "unknown",
  createdAt: "2026-08-30T01:00:02Z",
  updatedAt: "2026-08-30T01:00:03Z",
  source: "captured",
};

function authenticatedAuth(): DashboardAuthClient {
  return {
    discoverSession: async () => ({
      status: "authenticated",
      user: { githubLogin: "octocat", displayName: "Octo Cat", avatarUrl: "" },
    }),
    login: vi.fn(),
    logout: vi.fn(async (beforeApiLogout) => { await beforeApiLogout?.(); return true; }),
  };
}

function unavailableExtension(): DashboardExtensionConnection {
  return {
    start(onState) {
      onState({ status: "unavailable" });
      return () => undefined;
    },
    startSyncSession: vi.fn(async () => true),
    endSyncSession: vi.fn(async () => undefined),
  };
}

describe("Dashboard solution edit integration", () => {
  it("replaces the visible server solution only after a successful validated edit", async () => {
    const updated: DashboardServerSolution = {
      ...solution,
      title: "View revised",
      code: "class Main { int revised; }",
      updatedAt: "2026-08-30T02:00:00Z",
    };
    const updateClient: DashboardSolutionUpdateClient = {
      updateSolution: vi.fn(async () => updated),
    };

    render(<App
      dataSource={{ listSolutions: async () => [solution] }}
      authClient={authenticatedAuth()}
      extensionConnection={unavailableExtension()}
      solutionUpdateClient={updateClient}
    />);

    expect(await screen.findByText("class Main {}")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^제목 \*$/ }), { target: { value: "View revised" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^코드 \*$/ }), { target: { value: "class Main { int revised; }" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    expect(await screen.findByRole("heading", { name: "View revised" })).toBeInTheDocument();
    expect(screen.getByText("class Main { int revised; }")).toBeInTheDocument();
    expect(screen.queryByText("class Main {}")).not.toBeInTheDocument();
  });

  it("uses the existing signed-out teardown when editing receives 401", async () => {
    const writeConsent = vi.fn();
    const updateClient: DashboardSolutionUpdateClient = {
      updateSolution: vi.fn(async () => { throw new ArchiveSessionExpiredError("session expired"); }),
    };

    render(<App
      dataSource={{ listSolutions: async () => [solution] }}
      authClient={authenticatedAuth()}
      extensionConnection={unavailableExtension()}
      solutionUpdateClient={updateClient}
      consentStore={{ read: () => false, write: writeConsent }}
    />);

    await screen.findByText("class Main {}");
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "GitHub로 로그인" })).toBeInTheDocument());
    expect(screen.queryByText("class Main {}")).not.toBeInTheDocument();
    expect(writeConsent).toHaveBeenCalledWith(false, undefined);
  });
});
