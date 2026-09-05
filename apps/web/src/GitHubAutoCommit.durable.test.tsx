import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GitHubAutoCommit } from "./GitHubAutoCommit";
import { githubTestClient } from "./githubTestFixtures";
import { setDurableAutomationProfile } from "./durableAutomationState";

const PROFILE = {
  userId: "550e8400-e29b-41d4-a716-446655440000",
  deviceId: "device_identity_1234",
  generation: 4,
  sourceTransferEnabled: true,
  githubAutoCommitEnabled: true,
  ownershipMode: "DURABLE_SERVER" as const,
  targetGeneration: 2,
  target: {
    installationId: "11", repositoryId: "22", branch: "develop",
    expectedCommitSha: "a".repeat(40), folder: "solutions",
    privateRepository: true, fullName: "owner/repo",
  },
  automaticTransferConsent: true,
  visibilityRiskConsent: true,
  publicUploadConsent: false,
  githubEnabledAt: "2026-09-04T07:00:00Z",
  version: 7,
  updatedAt: "2026-09-04T08:00:00Z",
};

afterEach(() => setDurableAutomationProfile(null, false));

describe("GitHub durable automation presentation", () => {
  it("restores server ON without resuming the old page-owned lease/tick writer", async () => {
    setDurableAutomationProfile(PROFILE);
    const client = githubTestClient();
    const disable = vi.fn(async () => true);
    render(<GitHubAutoCommit
      client={client}
      target={null}
      eligible={false}
      blocked={false}
      onLock={() => undefined}
      onSessionExpired={() => undefined}
      onDurableDisable={disable}
      automationIntent={{ enabled: false, nonce: 1 }}
    />);

    expect(await screen.findByText("ON")).toBeInTheDocument();
    expect(screen.getByText(/Dashboard 문서가 닫혀도/)).toBeInTheDocument();
    expect(screen.getByText(/solutions\//)).toBeInTheDocument();
    expect(client.autoStatus).not.toHaveBeenCalled();
    expect(client.autoTick).not.toHaveBeenCalled();
    expect(client.autoStop).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("offline"));
    await Promise.resolve();
    expect(disable).not.toHaveBeenCalled();
    expect(client.autoStop).not.toHaveBeenCalled();
  });

  it("allows explicit UI OFF with no reselected local target after Dashboard reload", async () => {
    setDurableAutomationProfile(PROFILE);
    const client = githubTestClient();
    const disable = vi.fn(async () => true);
    render(<GitHubAutoCommit
      client={client}
      target={null}
      eligible={false}
      blocked={false}
      onLock={() => undefined}
      onSessionExpired={() => undefined}
      onDurableDisable={disable}
    />);
    fireEvent.click(await screen.findByRole("button", { name: "자동 커밋 OFF" }));
    await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());
    expect(client.autoStop).not.toHaveBeenCalled();
  });
});
