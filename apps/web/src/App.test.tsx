import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import type { DashboardArchiveDataSource } from "./archiveTypes";

const records = [
  {
    id: "one",
    platform: "SWEA",
    problemNumber: "1234",
    title: "중위순회",
    language: "Java",
    code: "class Solution {}",
    solvedAt: "2026-08-27",
    updatedAt: "2026-08-27T12:00:00.000Z",
    source: "captured" as const,
  },
  {
    id: "two",
    platform: "SWEA",
    problemNumber: "1954",
    title: "달팽이 숫자",
    language: "Python",
    code: "print('ok')",
    solvedAt: null,
    updatedAt: "2026-08-26T12:00:00.000Z",
    source: "manual" as const,
  },
];

describe("Dashboard archive shell", () => {
  it("loads archive records through the replaceable data source and selects a detail", async () => {
    const dataSource: DashboardArchiveDataSource = { listSolutions: async () => records };
    render(<App dataSource={dataSource} />);

    expect(screen.getByText("풀이 목록을 불러오는 중입니다.")).toBeInTheDocument();
    expect(await screen.findByText("class Solution {}")).toBeInTheDocument();
    expect(screen.getByText("2건 · 2문제")).toBeInTheDocument();
  });

  it("filters the archive without adding routing or global state", async () => {
    const dataSource: DashboardArchiveDataSource = { listSolutions: async () => records };
    render(<App dataSource={dataSource} />);
    await screen.findByText("2건 · 2문제");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "1954" } });
    const archiveList = screen.getByLabelText("전체 풀이 목록");
    expect(within(archiveList).getByText("달팽이 숫자")).toBeInTheDocument();
    expect(within(archiveList).queryByText("중위순회")).not.toBeInTheDocument();
    expect(screen.getByText("1건 · 1문제")).toBeInTheDocument();
    expect(within(screen.getByLabelText("풀이 상세")).getByText("달팽이 숫자")).toBeInTheDocument();
    expect(within(screen.getByLabelText("풀이 상세")).queryByText("중위순회")).not.toBeInTheDocument();
  });

  it("renders empty and safe error states", async () => {
    const { rerender } = render(<App dataSource={{ listSolutions: async () => [] }} />);
    expect(await screen.findByText("아직 표시할 풀이가 없습니다.")).toBeInTheDocument();

    rerender(<App dataSource={{ listSolutions: async () => { throw new Error("secret backend detail"); } }} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("풀이 목록을 불러오지 못했습니다."));
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret backend detail");
  });
});
