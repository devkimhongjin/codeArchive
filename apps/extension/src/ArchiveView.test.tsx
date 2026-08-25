import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Archive } from "./ArchiveView";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

const records: SolutionRecord[] = [
  {
    id: "auto", platform: "SWEA", problemNumber: "1234", title: "Auto", language: "Java", code: "auto-code",
    solvedAt: "2026-08-24", aiUsage: "unknown", createdAt: "2026-08-24T12:00:01.000Z", updatedAt: "2026-08-24T12:00:01.000Z",
    autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" },
    performance: { executionTime: "123 ms", memoryUsage: "45,678 kb" },
  },
  {
    id: "manual", platform: "BOJ", problemNumber: "1000", title: "Manual", language: "Python", code: "manual-code",
    solvedAt: null, aiUsage: "not_used", createdAt: "2026-08-24T15:07:59.000Z", updatedAt: "2026-08-24T15:07:59.000Z",
  },
];

function repository(): SolutionRepository {
  return {
    create: vi.fn(),
    list: vi.fn(async () => records),
    getById: vi.fn(async (id) => records.find((record) => record.id === id)),
    update: vi.fn(),
  } as SolutionRepository;
}

describe("Archive", () => {
  it("shows all records with provenance, KST display time, and optional performance", async () => {
    render(<Archive repository={repository()} />);
    expect(await screen.findByText("2건")).toBeInTheDocument();
    expect(screen.getByText("SWEA · 1234 · PASS 자동저장")).toBeInTheDocument();
    expect(screen.getByText("BOJ · 1000 · 수동저장")).toBeInTheDocument();
    expect(screen.getByText(/Java · 2026-08-24 · 2026-08-24 21:00/)).toBeInTheDocument();
    expect(screen.getByText("실행시간 123 ms · 메모리 45,678 kb")).toBeInTheDocument();
  });

  it("opens detail and copies exact code", async () => {
    const copyText = vi.fn(async () => undefined);
    render(<Archive repository={repository()} copyText={copyText} />);
    fireEvent.click(await screen.findByRole("button", { name: /Auto/ }));
    expect(await screen.findByText("2026-08-24 21:00:01 KST")).toBeInTheDocument();
    expect(screen.getByText("123 ms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("auto-code"));
    expect(screen.getByText("코드가 복사되었습니다")).toBeInTheDocument();
  });
});
