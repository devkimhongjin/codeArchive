import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Popup } from "./PopupView";
import type { SolutionRepository } from "./solutionRepository";
import type { CodeArchiveAutomationState } from "../../../packages/shared-types/src";

const state: CodeArchiveAutomationState = {
  protocolVersion: 1,
  autoSyncEnabled: false,
  githubAutoCommitEnabled: true,
  githubTargetConfigured: true,
  authenticated: true,
  connectionAvailable: true,
  errorCode: null,
};

function repository(): SolutionRepository {
  return {
    create: vi.fn(), list: vi.fn(async () => []), getById: vi.fn(), update: vi.fn(), delete: vi.fn(), setSyncMetadata: vi.fn(),
  } as unknown as SolutionRepository;
}

describe("Popup automation controls", () => {
  it("renders authoritative values and sends only the user's intent", async () => {
    const requestAutomationState = vi.fn(async () => ({ state, forwarded: true }));
    const setAutomation = vi.fn(async () => ({ accepted: true, state, forwarded: true }));
    render(<Popup repository={repository()} requestAutomationState={requestAutomationState} setAutomation={setAutomation} />);

    expect(await screen.findByLabelText("자동 동기화")).not.toBeChecked();
    expect(screen.getByLabelText("GitHub 자동 커밋")).toBeChecked();
    expect(requestAutomationState).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("자동 동기화"));
    await waitFor(() => expect(setAutomation).toHaveBeenCalledWith("AUTO_SYNC", true));
    expect(screen.getByLabelText("자동 동기화")).not.toBeChecked();
  });

  it("disables both controls while Dashboard is unavailable", async () => {
    const unavailable = { ...state, autoSyncEnabled: true, githubAutoCommitEnabled: true, connectionAvailable: false, errorCode: "DASHBOARD_DISCONNECTED" as const };
    render(<Popup repository={repository()} requestAutomationState={async () => ({ state: unavailable, forwarded: false })} setAutomation={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("자동 동기화")).toBeDisabled());
    expect(screen.getByLabelText("GitHub 자동 커밋")).toBeDisabled();
    expect(screen.getByText("Dashboard를 열어 연결한 뒤 자동화를 설정해주세요.")).toBeInTheDocument();
  });
});
