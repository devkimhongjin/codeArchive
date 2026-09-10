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

  it("fails closed when a command times out with a cached checked state", async () => {
    const checked = { ...state, autoSyncEnabled: true };
    const requestAutomationState = vi.fn(async () => ({ state: checked, forwarded: true }));
    const setAutomation = vi.fn(async () => ({ accepted: false, state: checked, forwarded: true }));
    render(<Popup repository={repository()} requestAutomationState={requestAutomationState} setAutomation={setAutomation} />);

    expect(await screen.findByLabelText("자동 동기화")).toBeChecked();
    fireEvent.click(screen.getByLabelText("자동 동기화"));
    await waitFor(() => expect(setAutomation).toHaveBeenCalledWith("AUTO_SYNC", false));
    await waitFor(() => expect(screen.getByLabelText("자동 동기화")).not.toBeChecked());
    expect(screen.getByText("Dashboard를 열어 연결한 뒤 자동화를 설정해주세요.")).toBeInTheDocument();
  });

  it("disables both controls while Dashboard is unavailable", async () => {
    const unavailable = { ...state, autoSyncEnabled: true, githubAutoCommitEnabled: true, connectionAvailable: false, errorCode: "DASHBOARD_DISCONNECTED" as const };
    render(<Popup repository={repository()} requestAutomationState={async () => ({ state: unavailable, forwarded: false })} setAutomation={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("자동 동기화")).toBeDisabled());
    expect(screen.getByLabelText("GitHub 자동 커밋")).toBeDisabled();
    expect(screen.getByText("Dashboard를 열어 연결한 뒤 자동화를 설정해주세요.")).toBeInTheDocument();
  });

  it("allows local AUTO_SYNC stop while Dashboard is disconnected", async () => {
    const unavailable = { ...state, autoSyncEnabled: false, connectionAvailable: false, errorCode: "DASHBOARD_DISCONNECTED" as const };
    const requestRelayState = vi.fn(async () => ({ state: "ACTIVE" as const, autoSyncEnabled: true, grantId: "grant", generation: 2 }));
    const stopRelayLocally = vi.fn(async () => ({ state: "REVOCATION_PENDING" as const, autoSyncEnabled: false, grantId: "grant", generation: 2 }));
    const setAutomation = vi.fn();
    render(<Popup repository={repository()} requestAutomationState={async () => ({ state: unavailable, forwarded: false })} setAutomation={setAutomation} requestRelayState={requestRelayState} stopRelayLocally={stopRelayLocally} />);

    const stop = await screen.findByRole("button", { name: "자동 동기화 로컬 중지" });
    fireEvent.click(stop);
    await waitFor(() => expect(stopRelayLocally).toHaveBeenCalledOnce());
    expect(setAutomation).not.toHaveBeenCalled();
    expect(await screen.findByText("로컬 relay 상태: 해지 대기")).toBeInTheDocument();
  });

  it.each([
    ["UNPAIRED", "비활성 · 페어링 안 됨"],
    ["EXPIRED", "만료됨"],
    ["INVALIDATED", "무효화됨"],
  ] as const)("renders the %s relay state", async (relayState, label) => {
    render(<Popup
      repository={repository()}
      requestAutomationState={async () => ({ state, forwarded: false })}
      requestRelayState={async () => ({ state: relayState, autoSyncEnabled: false, readStatus: "ready" })}
    />);

    expect(await screen.findByText(`로컬 relay 상태: ${label}`)).toBeInTheDocument();
  });

  it("renders loading and read-error relay diagnostics instead of swallowing them", async () => {
    let resolve!: (value: { state: "UNPAIRED"; autoSyncEnabled: boolean; readStatus: "ready" }) => void;
    const pending = new Promise<{ state: "UNPAIRED"; autoSyncEnabled: boolean; readStatus: "ready" }>((next) => { resolve = next; });
    const view = render(<Popup
      repository={repository()}
      requestAutomationState={async () => ({ state, forwarded: false })}
      requestRelayState={() => pending}
    />);
    expect(screen.getByText("로컬 relay 상태: 불러오는 중...")).toBeInTheDocument();
    resolve({ state: "UNPAIRED", autoSyncEnabled: false, readStatus: "ready" });
    await waitFor(() => expect(screen.getByText("로컬 relay 상태: 비활성 · 페어링 안 됨")).toBeInTheDocument());

    view.unmount();
    render(<Popup
      repository={repository()}
      requestAutomationState={async () => ({ state, forwarded: false })}
      requestRelayState={async () => { throw new Error("state read failed"); }}
    />);
    expect(await screen.findByText("로컬 relay 상태: 읽기 실패")).toBeInTheDocument();
  });

  it("renders a sanitized last-failure category without exposing response content", async () => {
    render(<Popup
      repository={repository()}
      requestAutomationState={async () => ({ state, forwarded: false })}
      requestRelayState={async () => ({
        state: "INVALIDATED",
        autoSyncEnabled: false,
        readStatus: "ready",
        lastFailure: { category: "HTTP_OTHER", status: 404, occurredAt: "2026-09-08T06:00:00.000Z", requestId: "req-safe", errorCode: "RELAY_NOT_FOUND" },
      })}
    />);

    expect(await screen.findByText("최근 실패: 서버 응답 오류 (HTTP 404)")).toBeInTheDocument();
    expect(screen.getByText("실패 시각: 2026-09-08 15:00:00 KST")).toBeInTheDocument();
    expect(screen.getByText("서버 오류 코드: RELAY_NOT_FOUND")).toBeInTheDocument();
    expect(screen.getByText("요청 ID: req-safe")).toBeInTheDocument();
  });

  it("shows missing server metadata explicitly and does not equate 401 with expiry", async () => {
    render(<Popup
      repository={repository()}
      requestAutomationState={async () => ({ state, forwarded: false })}
      requestRelayState={async () => ({
        state: "EXPIRED", autoSyncEnabled: false, readStatus: "ready",
        lastFailure: { category: "HTTP_401", status: 401, occurredAt: "2026-09-09T00:17:31.000Z" },
      })}
    />);
    expect(await screen.findByText("최근 실패: 서버 인증 거부 (HTTP 401)")).toBeInTheDocument();
    expect(screen.getByText("실패 시각: 2026-09-09 09:17:31 KST")).toBeInTheDocument();
    expect(screen.getByText("서버 오류 코드: 제공되지 않음")).toBeInTheDocument();
    expect(screen.getByText("요청 ID: 제공되지 않음")).toBeInTheDocument();
    expect(screen.queryByText(/서버 인증 만료/)).not.toBeInTheDocument();
  });
});
