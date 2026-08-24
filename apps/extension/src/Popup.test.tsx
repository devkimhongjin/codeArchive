import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Popup } from "./PopupView";
import type { SolutionRepository } from "./solutionRepository";
import type { SolutionRecord } from "./solution";

const savedRecord: SolutionRecord = {
  id: "solution-1",
  platform: "BOJ",
  problemNumber: "1000",
  title: "A+B",
  language: "Java",
  code: "class Main {}",
  solvedAt: "2026-08-24",
  aiUsage: "not_used",
  createdAt: "2026-08-24T06:00:00.000Z",
  updatedAt: "2026-08-24T06:00:00.000Z",
};

function createRepository(): SolutionRepository {
  let records: SolutionRecord[] = [];
  return {
    create: vi.fn(async (input) => {
      records = [{ ...savedRecord, ...input }];
      return records[0];
    }),
    list: vi.fn(async () => records),
  };
}

describe("Popup", () => {
  it("blocks save when required fields are missing", async () => {
    const repository = createRepository();
    render(<Popup repository={repository} />);

    fireEvent.click(screen.getByRole("button", { name: "새 풀이 등록" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("필수 입력값을 모두 입력해주세요.");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("saves a solution and shows it in the local list", async () => {
    const repository = createRepository();
    render(<Popup repository={repository} />);

    fireEvent.click(screen.getByRole("button", { name: "새 풀이 등록" }));
    fireEvent.change(screen.getByLabelText(/플랫폼/), { target: { value: "BOJ" } });
    fireEvent.change(screen.getByLabelText(/문제 번호/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "A+B" } });
    fireEvent.change(screen.getByLabelText(/언어/), { target: { value: "Java" } });
    fireEvent.change(screen.getByLabelText(/코드/), { target: { value: "class Main {}" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(repository.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("A+B")).toBeInTheDocument();
    expect(screen.getByText("BOJ · 1000")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("IndexedDB 로컬 저장");
  });
});
