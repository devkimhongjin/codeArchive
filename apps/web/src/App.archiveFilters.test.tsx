import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardSolution } from "./archiveTypes";
import type { DashboardAuthClient } from "./authClient";
import type { DashboardExtensionConnection } from "./extensionConnection";

const records: DashboardSolution[] = [
  { id: "ten-new", platform: "SWEA", problemNumber: "10", title: "열 번째 문제", language: "Java", code: "new java", solvedAt: "2026-08-31", updatedAt: "2026-08-31T00:00:00Z", source: "captured" },
  { id: "two", platform: "SWEA", problemNumber: "2", title: "두 번째 문제", language: "Python", code: "python two", solvedAt: "2026-08-30", updatedAt: "2026-08-30T00:00:00Z", source: "captured" },
  { id: "ten-old", platform: "SWEA", problemNumber: "10", title: "열 번째 문제", language: "Python", code: "old python", solvedAt: "2026-08-28", updatedAt: "2026-08-28T00:00:00Z", source: "captured" },
  { id: "programmers", platform: "PROGRAMMERS", problemNumber: "10", title: "다른 플랫폼", language: "Java", code: "other java", solvedAt: null, updatedAt: "2026-08-29T00:00:00Z", source: "captured" },
];
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440000";

function fixtures() {
  const authClient: DashboardAuthClient = {
    discoverSession: vi.fn(async () => ({ status: "authenticated" as const, user: { id: ACCOUNT_ID, githubLogin: "tester", displayName: "Tester", avatarUrl: "" } })),
    login: vi.fn(), logout: vi.fn(async () => true),
  };
  const extensionConnection: DashboardExtensionConnection = {
    start: vi.fn((onState) => {
      onState({ status: "connected", summary: { protocolVersion: 1, pendingCount: 1, allCount: 4, revision: 1 } });
      return () => {};
    }),
    startSyncSession: vi.fn(async () => true), endSyncSession: vi.fn(async () => {}),
  };
  return {
    authClient, extensionConnection,
    dataSource: { listSolutions: vi.fn(async () => records) },
    consentStore: { read: () => false, write: vi.fn() },
    dashboardOrigin: "https://codearchive-dashboard-beta.onrender.com",
  };
}

const change = (label: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
const list = () => screen.getByRole("region", { name: "전체 풀이 목록" });
const detail = () => screen.getByRole("region", { name: "풀이 상세" });

describe("Dashboard archive discovery", () => {
  it("combines filters, clears hidden details, and resets no results without API or sync side effects", async () => {
    const props = fixtures();
    render(<App {...props} />);
    await screen.findByText("4건 · 3문제");
    expect(within(screen.getByRole("combobox", { name: "플랫폼" })).queryByRole("option", { name: "JUNGOL" })).not.toBeInTheDocument();
    change("플랫폼", "SWEA");
    change("언어", "Python");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  10  " } });
    expect(screen.getByText("1건 · 1문제")).toBeInTheDocument();
    expect(within(detail()).getByText("old python")).toBeInTheDocument();
    expect(within(detail()).queryByText("new java")).not.toBeInTheDocument();
    change("플랫폼", "PROGRAMMERS");
    expect(screen.getByText("0건 · 0문제")).toBeInTheDocument();
    expect(screen.getByText(/검색 결과가 없습니다/)).toBeInTheDocument();
    expect(within(detail()).queryByText("old python")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "검색·필터 초기화" }));
    expect(screen.getByText("4건 · 3문제")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "검색·필터 초기화" })).toBeDisabled();
    expect(screen.getByText(/서버 기록 최대 50건/)).toBeInTheDocument();
    expect(props.dataSource.listSolutions).toHaveBeenCalledTimes(1);
    expect(props.extensionConnection.startSyncSession).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /자동 동기화/ })).not.toBeChecked();
  });

  it("aligns the fallback selection with sorted rows and preserves a visible manual selection", async () => {
    render(<App {...fixtures()} />);
    await screen.findByText("4건 · 3문제");
    change("정렬", "updated_asc");
    expect(within(list()).getAllByRole("button")[0]).toHaveTextContent("2026-08-28");
    expect(within(list()).getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(detail()).getByText("old python")).toBeInTheDocument();
    change("플랫폼", "SWEA");
    change("정렬", "problem_number");
    expect(within(list()).getAllByRole("article")[0]).toHaveTextContent("두 번째 문제");
    expect(within(detail()).getByText("python two")).toBeInTheDocument();
    fireEvent.click(within(list()).getByRole("button", { name: /Java.*2026-08-31/ }));
    change("정렬", "updated_asc");
    expect(within(detail()).getByText("new java")).toBeInTheDocument();
    expect(within(list()).getByRole("button", { name: /Java.*2026-08-31/ })).toHaveAttribute("aria-pressed", "true");
    change("언어", "Python");
    expect(within(detail()).queryByText("new java")).not.toBeInTheDocument();
    expect(within(detail()).getByText("old python")).toBeInTheDocument();
  });

  it("keeps a removed filter understandable after refresh and resets controls for the next account", async () => {
    const props = fixtures();
    const { rerender } = render(<App {...props} />);
    await screen.findByText("4건 · 3문제");
    change("플랫폼", "PROGRAMMERS");
    change("언어", "Java");
    change("정렬", "updated_asc");
    props.dataSource.listSolutions.mockResolvedValueOnce([records[1]]);
    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));
    await screen.findByRole("option", { name: "PROGRAMMERS (현재 기록 없음)" });
    expect(screen.getByRole("combobox", { name: "플랫폼" })).toHaveValue("PROGRAMMERS");
    expect(screen.getByText(/검색 결과가 없습니다/)).toBeInTheDocument();
    const next = fixtures();
    next.authClient.discoverSession = vi.fn(async () => ({ status: "authenticated" as const, user: { id: "650e8400-e29b-41d4-a716-446655440000", githubLogin: "other", displayName: "Other", avatarUrl: "" } }));
    rerender(<App {...props} authClient={next.authClient} />);
    await screen.findByText("Other");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "플랫폼" })).toHaveValue(""));
    expect(screen.getByRole("combobox", { name: "언어" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "정렬" })).toHaveValue("updated_desc");
    expect(props.extensionConnection.startSyncSession).not.toHaveBeenCalled();
  });
});
