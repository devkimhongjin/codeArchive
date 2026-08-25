import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    create: vi.fn(async (input) => {
      const record: SolutionRecord = { ...savedRecord, id: `solution-${records.length + 1}`, ...input };
      records = [record, ...records];
      return record;
    }),
    list: vi.fn(async () => records),
    getById: vi.fn(async (id) => records.find((record) => record.id === id)),
    update: vi.fn(async (id, input) => {
      const current = records.find((record) => record.id === id);
      if (!current) throw new Error("not found");
      const updated: SolutionRecord = { ...current, ...input, createdAt: current.createdAt, updatedAt: "2026-08-24T07:00:00.000Z" };
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

  it("saves a manual solution and labels its provenance", async () => {
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
    expect(screen.getByText("BOJ · 1000 · 수동저장")).toBeInTheDocument();
  });

  it("shows PASS auto provenance and uses observedAt in KST minute precision", async () => {
    render(<Popup repository={createRepository([{
      ...savedRecord, platform: "SWEA",
      autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-24T12:34:56.000Z" },
      updatedAt: "2026-08-24T15:00:00.000Z",
    }])} />);
    expect(await screen.findByText("SWEA · 1000 · PASS 자동저장")).toBeInTheDocument();
    expect(screen.getByText("Java · 2026-08-24 21:34")).toBeInTheDocument();
  });

  it("falls back to updatedAt for manual list timestamps", async () => {
    render(<Popup repository={createRepository([{ ...savedRecord, updatedAt: "2026-08-24T15:07:59.000Z" }])} />);
    expect(await screen.findByText("Java · 2026-08-25 00:07")).toBeInTheDocument();
  });

  it("limits popup preview to five records and opens the archive", async () => {
    const records = Array.from({ length: 6 }, (_, index) => ({ ...savedRecord, id: `id-${index}`, problemNumber: `${1000 + index}`, title: `title-${index}` }));
    const openArchive = vi.fn();
    render(<Popup repository={createRepository(records)} openArchive={openArchive} />);
    expect(await screen.findByText("저장된 풀이 6건")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /title-/ })).toHaveLength(5);
    expect(screen.queryByText("title-5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전체 풀이 보기" }));
    expect(openArchive).toHaveBeenCalledTimes(1);
  });

  it("copies exact code and reports success without false success on failure", async () => {
    const copyText = vi.fn(async () => undefined);
    const { rerender } = render(<Popup repository={createRepository([savedRecord])} copyText={copyText} />);
    fireEvent.click(await screen.findByRole("button", { name: /A\+B/ }));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("class Main {}"));
    expect(screen.getByText("코드가 복사되었습니다")).toBeInTheDocument();

    const failingCopy = vi.fn(async () => { throw new Error("denied"); });
    rerender(<Popup repository={createRepository([savedRecord])} copyText={failingCopy} />);
    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));
    fireEvent.click(await screen.findByRole("button", { name: /A\+B/ }));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("코드를 복사하지 못했습니다.");
    expect(screen.queryByText("코드가 복사되었습니다")).not.toBeInTheDocument();
  });

  it("stores two manual performance strings exactly", async () => {
    const repository = createRepository([savedRecord]);
    render(<Popup repository={repository} />);
    fireEvent.click(await screen.findByRole("button", { name: /A\+B/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("실행시간"), { target: { value: " 123 ms " } });
    fireEvent.change(screen.getByLabelText("메모리"), { target: { value: " 45,678 kb " } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(1));
    expect(repository.update).toHaveBeenCalledWith(savedRecord.id, expect.objectContaining({ performance: { executionTime: "123 ms", memoryUsage: "45,678 kb" } }));
    expect(await screen.findByText("123 ms")).toBeInTheDocument();
    expect(screen.getByText("45,678 kb")).toBeInTheDocument();
  });

  it("removes performance when both fields are cleared", async () => {
    const repository = createRepository([{ ...savedRecord, performance: { executionTime: "123 ms", memoryUsage: "45 kb" } }]);
    render(<Popup repository={repository} />);
    fireEvent.click(await screen.findByRole("button", { name: /A\+B/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("실행시간"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("메모리"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(1));
    expect(repository.update).toHaveBeenCalledWith(savedRecord.id, expect.objectContaining({ performance: undefined }));
    expect(screen.queryByText("123 ms")).not.toBeInTheDocument();
  });

  it("blocks one-sided performance input", async () => {
    const repository = createRepository([savedRecord]);
    render(<Popup repository={repository} />);
    fireEvent.click(await screen.findByRole("button", { name: /A\+B/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("실행시간"), { target: { value: "123 ms" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("실행시간과 메모리는 둘 다 입력하거나 둘 다 비워주세요.");
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("opens a saved solution detail and updates it", async () => {
    const repository = createRepository([savedRecord]);
    render(<Popup repository={repository} />);
    fireEvent.click(await screen.findByRole("button", { name: /A\+B/ }));
    expect(await screen.findByRole("heading", { name: "A+B" })).toBeInTheDocument();
    expect(screen.getByText("수동저장")).toBeInTheDocument();
    expect(screen.getByText("class Main {}", { selector: "code" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "A+B 수정" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "A+B 수정" })).toBeInTheDocument();
  });

  it("loads a source file and solving-page fields without auto-saving", async () => {
    const repository = createRepository();
    const { unmount } = render(<Popup repository={repository} />);
    fireEvent.change(screen.getByLabelText("파일 가져오기"), { target: { files: [{ name: "Main.java", text: vi.fn(async () => "class Main {}") }] } });
    expect(await screen.findByText(/Main.java에서 가져왔습니다/)).toBeInTheDocument();
    expect(repository.create).not.toHaveBeenCalled();
    unmount();

    render(<Popup repository={repository} requestPageContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current", metadata: { status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, warnings: [] }, editor: { status: "detected", editor: { language: "Java", code: "class Main {}" }, warnings: [] }, submissionResult: { status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] } } })} />);
    fireEvent.click(await screen.findByRole("button", { name: "등록 폼에 채우기" }));
    expect(screen.getByLabelText(/문제 번호/)).toHaveValue("1234");
    expect(screen.getByLabelText(/코드/)).toHaveValue("class Main {}");
    expect(repository.create).not.toHaveBeenCalled();
  });
});
