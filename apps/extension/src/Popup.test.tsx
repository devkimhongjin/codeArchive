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

function createRepository(initialRecords: SolutionRecord[] = []): SolutionRepository {
  let records = [...initialRecords];
  return {
    create: vi.fn(async (input) => {
      const record = { ...savedRecord, ...input };
      records = [record, ...records];
      return record;
    }),
    list: vi.fn(async () => records),
    getById: vi.fn(async (id) => records.find((record) => record.id === id)),
    update: vi.fn(async (id, input) => {
      const current = records.find((record) => record.id === id);
      if (!current) throw new Error("not found");
      const updated = {
        ...current,
        ...input,
        createdAt: current.createdAt,
        updatedAt: "2026-08-24T07:00:00.000Z",
      };
      records = records.map((record) => record.id === id ? updated : record);
      return updated;
    }),
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

  it("opens a saved solution detail and updates it", async () => {
    const repository = createRepository([savedRecord]);
    render(<Popup repository={repository} />);

    const recordButton = await screen.findByRole("button", { name: /A\+B/ });
    fireEvent.click(recordButton);

    expect(await screen.findByRole("heading", { name: "A+B" })).toBeInTheDocument();
    expect(screen.getByText("class Main {}", { selector: "code" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "A+B 수정" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "A+B 수정" })).toBeInTheDocument();
    expect(repository.update).toHaveBeenCalledWith(
      savedRecord.id,
      expect.objectContaining({ title: "A+B 수정" }),
    );
  });
});
