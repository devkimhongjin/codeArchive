import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Popup } from "./PopupView";
import type { SolutionRepository } from "./solutionRepository";
import type { SolutionRecord } from "./solution";

const savedRecord: SolutionRecord = {
  id: "solution-1", platform: "BOJ", problemNumber: "1000", title: "A+B", language: "Java", code: "class Main {}",
  solvedAt: "2026-08-24", aiUsage: "not_used", createdAt: "2026-08-24T06:00:00.000Z", updatedAt: "2026-08-24T06:00:00.000Z",
};

function createRepository(initialRecords: SolutionRecord[] = []): SolutionRepository {
  let records = [...initialRecords];
  return {
    create: vi.fn(async (input) => { const record: SolutionRecord = { ...savedRecord, id: `solution-${records.length + 1}`, ...input }; records = [record, ...records]; return record; }),
    list: vi.fn(async () => records),
    getById: vi.fn(async (id) => records.find((record) => record.id === id)),
    update: vi.fn(async (id, input) => { const current = records.find((record) => record.id === id); if (!current) throw new Error("not found"); const updated: SolutionRecord = { ...current, ...input, createdAt: current.createdAt, updatedAt: "2026-08-24T07:00:00.000Z" }; if (!input.performance) delete updated.performance; records = records.map((record) => record.id === id ? updated : record); return updated; }),
    delete: vi.fn(async (id) => { records = records.filter((record) => record.id !== id); }),
  };
}

async function expandAndOpen(title = "A+B"): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  fireEvent.click(screen.getByRole("button", { name: /수동저장|PASS 자동저장/ }));
  expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
}

describe("Popup", () => {
  beforeEach(() => localStorage.clear());

  it("groups submissions by platform and problemNumber and limits recent problem groups to five", async () => {
    const sameProblemOlder = { ...savedRecord, id: "older", updatedAt: "2026-08-24T05:00:00.000Z" };
    const otherGroups = Array.from({ length: 5 }, (_, index) => ({ ...savedRecord, id: `other-${index}`, problemNumber: `${2000 + index}`, title: `Other ${index}`, updatedAt: `2026-08-24T0${9 - index}:00:00.000Z` }));
    render(<Popup repository={createRepository([savedRecord, sameProblemOlder, ...otherGroups])} />);
    expect(await screen.findByText("저장된 풀이 7건 · 6문제")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(5);
    expect(screen.queryByText("A+B")).not.toBeInTheDocument();
  });

  it("shows group count, expands children in updatedAt desc, and uses updatedAt rather than observedAt", async () => {
    const auto: SolutionRecord = { ...savedRecord, id: "auto", platform: "SWEA", problemNumber: "1234", title: "Same", updatedAt: "2026-08-24T15:00:00.000Z", autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-24T12:34:56.000Z" } };
    const manual: SolutionRecord = { ...auto, id: "manual", autoCapture: undefined, updatedAt: "2026-08-24T14:00:00.000Z" };
    render(<Popup repository={createRepository([manual, auto])} />);
    const group = await screen.findByRole("button", { name: /Same.*2회.*2026-08-25 00:00/ });
    fireEvent.click(group);
    const children = screen.getAllByRole("button", { name: /PASS 자동저장|수동저장/ });
    expect(children[0]).toHaveTextContent("2026-08-25 00:00");
    expect(children[1]).toHaveTextContent("2026-08-24 23:00");
    expect(screen.queryByText(/21:34/)).not.toBeInTheDocument();
  });

  it("keeps popup detail actions in parity and removes JSON export", async () => {
    render(<Popup repository={createRepository([savedRecord])} />);
    await expandAndOpen();
    for (const name of ["수정", "코드 복사", "Source", "Markdown", "삭제"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "JSON" })).not.toBeInTheDocument();
    expect(screen.getByText("2026-08-24 15:00:00 KST")).toBeInTheDocument();
  });

  it("copies raw code by default and persists copy annotation settings", async () => {
    const copyText = vi.fn(async () => undefined);
    const repository = createRepository([{ ...savedRecord, performance: { executionTime: "123 ms", memoryUsage: "45 kb" } }]);
    const { unmount } = render(<Popup repository={repository} copyText={copyText} />);
    await expandAndOpen();
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith("class Main {}"));
    fireEvent.click(screen.getByLabelText("문제 정보 주석"));
    fireEvent.click(screen.getByLabelText("언어 주석"));
    fireEvent.click(screen.getByLabelText("실행시간·메모리 주석"));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith("// BOJ 1000 · A+B\n// 언어: Java\n// 실행시간: 123 ms · 메모리: 45 kb\nclass Main {}"));
    unmount();
    render(<Popup repository={repository} copyText={copyText} />);
    await expandAndOpen();
    expect(screen.getByLabelText("문제 정보 주석")).toBeChecked();
    expect(screen.getByLabelText("언어 주석")).toBeChecked();
    expect(screen.getByLabelText("실행시간·메모리 주석")).toBeChecked();
  });

  it("deletes only the selected record after confirmation and refreshes the group", async () => {
    const sibling = { ...savedRecord, id: "solution-2", updatedAt: "2026-08-24T05:00:00.000Z" };
    const repository = createRepository([savedRecord, sibling]);
    render(<Popup repository={repository} confirmDelete={() => true} />);
    fireEvent.click(await screen.findByRole("button", { name: /A\+B.*2회/ }));
    const children = screen.getAllByRole("button", { name: /수동저장/ });
    fireEvent.click(children[0]);
    expect(await screen.findByRole("heading", { name: "A+B" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(repository.delete).toHaveBeenCalledWith("solution-1"));
    expect(await screen.findByText("저장된 풀이 1건 · 1문제")).toBeInTheDocument();
  });

  it("does not delete when confirmation is cancelled", async () => {
    const repository = createRepository([savedRecord]);
    render(<Popup repository={repository} confirmDelete={() => false} />);
    await expandAndOpen();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("keeps manual performance both-or-none validation", async () => {
    const repository = createRepository([savedRecord]);
    render(<Popup repository={repository} />);
    await expandAndOpen();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("실행시간"), { target: { value: "123 ms" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("실행시간과 메모리는 둘 다 입력하거나 둘 다 비워주세요.");
    expect(repository.update).not.toHaveBeenCalled();
  });
});
