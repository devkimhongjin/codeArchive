import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Archive } from "./ArchiveView";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

const auto: SolutionRecord = {
  id: "auto", platform: "SWEA", problemNumber: "1234", title: "Auto", language: "Java", code: "auto-code",
  solvedAt: "2026-08-24", aiUsage: "unknown", createdAt: "2026-08-24T12:00:01.000Z", updatedAt: "2026-08-24T15:00:01.000Z",
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" },
  performance: { executionTime: "123 ms", memoryUsage: "45,678 kb" },
};
const older: SolutionRecord = { ...auto, id: "older", code: "older-code", updatedAt: "2026-08-24T14:00:00.000Z" };

function createRepository(initial: SolutionRecord[] = [auto, older]): SolutionRepository {
  let records = [...initial];
  return {
    create: vi.fn(),
    list: vi.fn(async () => records),
    getById: vi.fn(async (id) => records.find((record) => record.id === id)),
    update: vi.fn(async (id, input) => { const current = records.find((record) => record.id === id); if (!current) throw new Error("not found"); const updated = { ...current, ...input, updatedAt: "2026-08-24T16:00:00.000Z" }; records = records.map((record) => record.id === id ? updated : record); return updated; }),
    delete: vi.fn(async (id) => { records = records.filter((record) => record.id !== id); }),
    setSyncMetadata: vi.fn(async (id, sync) => { const current = records.find((record) => record.id === id); if (!current) throw new Error("not found"); const updated = { ...current, sync }; records = records.map((record) => record.id === id ? updated : record); return updated; }),
  };
}

async function openAutoDetail(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /Auto.*2회/ }));
  fireEvent.click(screen.getAllByRole("button", { name: /PASS 자동저장/ })[0]);
  expect(await screen.findByRole("heading", { name: "Auto" })).toBeInTheDocument();
}

describe("Archive", () => {
  beforeEach(() => localStorage.clear());

  it("shows all problem groups and child submissions ordered by updatedAt", async () => {
    render(<Archive repository={createRepository()} />);
    expect(await screen.findByText("2건 · 1문제")).toBeInTheDocument();
    const group = screen.getByRole("button", { name: /Auto.*2회.*2026-08-25 00:00/ });
    fireEvent.click(group);
    const children = screen.getAllByRole("button", { name: /PASS 자동저장/ });
    expect(children[0]).toHaveTextContent("2026-08-25 00:00");
    expect(children[1]).toHaveTextContent("2026-08-24 23:00");
  });

  it("uses updatedAt as the only detail time and provides popup action parity without JSON", async () => {
    render(<Archive repository={createRepository()} />);
    await openAutoDetail();
    expect(screen.getByText("2026-08-25 00:00:01 KST")).toBeInTheDocument();
    expect(screen.queryByText(/표시 시각/)).not.toBeInTheDocument();
    for (const name of ["수정", "코드 복사", "Source", "Markdown", "삭제"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "JSON" })).not.toBeInTheDocument();
  });

  it("shares persisted copy settings and formats annotated copy text", async () => {
    localStorage.setItem("codearchive.copy-settings.v1", JSON.stringify({ includeProblemInfo: true, includeLanguage: true, includePerformance: true }));
    const copyText = vi.fn(async () => undefined);
    render(<Archive repository={createRepository()} copyText={copyText} />);
    await openAutoDetail();
    expect(screen.getByLabelText("문제 정보 주석")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("// SWEA 1234 · Auto\n// 언어: Java\n// 실행시간: 123 ms · 메모리: 45,678 kb\nauto-code"));
  });

  it("edits the selected archive record", async () => {
    const repository = createRepository();
    render(<Archive repository={repository} />);
    await openAutoDetail();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "Auto edited" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledWith("auto", expect.objectContaining({ title: "Auto edited" })));
    expect(await screen.findByRole("heading", { name: "Auto edited" })).toBeInTheDocument();
  });

  it("deletes only one exact child after confirm and keeps its sibling", async () => {
    const repository = createRepository();
    render(<Archive repository={repository} confirmDelete={() => true} />);
    await openAutoDetail();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(repository.delete).toHaveBeenCalledWith("auto"));
    expect(await screen.findByText("1건 · 1문제")).toBeInTheDocument();
  });

  it("cancels delete without mutation", async () => {
    const repository = createRepository();
    render(<Archive repository={repository} confirmDelete={() => false} />);
    await openAutoDetail();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
