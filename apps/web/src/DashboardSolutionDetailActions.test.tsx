import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { DashboardServerSolution } from "./archiveTypes";
import { SolutionDetailActions } from "./DashboardSolutionDetailActions";
import type { DashboardSolutionUpdateClient } from "./solutionUpdateClient";

const solution: DashboardServerSolution = {
  id: "solution-1",
  clientRecordId: "capture-1",
  platform: "SWEA",
  problemNumber: "1206",
  title: "View",
  language: "Java",
  code: "class Main {}",
  result: "ACCEPTED",
  solvedAt: "2026-08-30T01:00:00Z",
  observedAt: "2026-08-30T01:00:01Z",
  aiUsage: "unknown",
  createdAt: "2026-08-30T01:00:02Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
  source: "captured",
  executionTime: "123",
  memoryUsage: "45678",
};

describe("SolutionDetailActions", () => {
  beforeEach(() => localStorage.clear());

  it("copies selected solution code and applies persisted formatting settings", async () => {
    const copyText = vi.fn(async () => undefined);
    const { unmount } = render(<SolutionDetailActions solution={solution} copyText={copyText} />);

    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith("class Main {}"));

    fireEvent.click(screen.getByLabelText("문제 정보 주석"));
    fireEvent.click(screen.getByLabelText("언어 주석"));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith("// SWEA 1206 · View\n// 언어: Java\nclass Main {}"));

    unmount();
    render(<SolutionDetailActions solution={solution} copyText={copyText} />);
    expect(screen.getByLabelText("문제 정보 주석")).toBeChecked();
    expect(screen.getByLabelText("언어 주석")).toBeChecked();
  });

  it("downloads source with copy formatting and Markdown with detail metadata", () => {
    const downloadText = vi.fn();
    render(<SolutionDetailActions solution={solution} downloadText={downloadText} />);
    fireEvent.click(screen.getByLabelText("문제 정보 주석"));
    fireEvent.click(screen.getByRole("button", { name: "Source 다운로드" }));
    expect(downloadText).toHaveBeenLastCalledWith(
      "SWEA-1206-View.java",
      "// SWEA 1206 · View\nclass Main {}",
      "text/plain;charset=utf-8",
    );

    fireEvent.click(screen.getByRole("button", { name: "Markdown 다운로드" }));
    expect(downloadText).toHaveBeenLastCalledWith(
      "SWEA-1206-View.md",
      expect.stringContaining("```java\nclass Main {}\n```"),
      "text/markdown;charset=utf-8",
    );
  });

  it("prefills the edit form from the selected server solution and saves through the update client", async () => {
    const updated: DashboardServerSolution = {
      ...solution,
      title: "View revised",
      code: "class Main { int revised; }",
      aiUsage: "not_used",
      updatedAt: "2026-08-30T11:00:00.000Z",
    };
    const updateSolution = vi.fn(async () => updated);
    const updateClient: DashboardSolutionUpdateClient = { updateSolution };
    const onSolutionUpdated = vi.fn();

    render(<SolutionDetailActions
      solution={solution}
      updateClient={updateClient}
      onSolutionUpdated={onSolutionUpdated}
    />);

    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.getByLabelText(/플랫폼/)).toHaveValue("SWEA");
    expect(screen.getByLabelText(/문제 번호/)).toHaveValue("1206");
    expect(screen.getByLabelText(/제목/)).toHaveValue("View");
    expect(screen.getByLabelText(/언어/)).toHaveValue("Java");
    expect(screen.getByLabelText(/코드/)).toHaveValue("class Main {}");
    expect(screen.getByLabelText("실행시간")).toHaveValue("123");
    expect(screen.getByLabelText("메모리")).toHaveValue("45678");
    expect(screen.getByLabelText("AI 활용")).toHaveValue("unknown");

    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "View revised" } });
    fireEvent.change(screen.getByLabelText(/코드/), { target: { value: "class Main { int revised; }" } });
    fireEvent.change(screen.getByLabelText("AI 활용"), { target: { value: "not_used" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    await waitFor(() => expect(updateSolution).toHaveBeenCalledWith(
      solution,
      expect.objectContaining({
        title: "View revised",
        code: "class Main { int revised; }",
        aiUsage: "not_used",
      }),
    ));
    expect(onSolutionUpdated).toHaveBeenCalledWith(updated);
    expect(await screen.findByRole("status")).toHaveTextContent("풀이가 수정되었습니다.");
  });

  it("does not publish a success update when the API client fails", async () => {
    const updateClient: DashboardSolutionUpdateClient = {
      updateSolution: vi.fn(async () => { throw new Error("failed"); }),
    };
    const onSolutionUpdated = vi.fn();
    render(<SolutionDetailActions solution={solution} updateClient={updateClient} onSolutionUpdated={onSolutionUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("풀이를 수정하지 못했습니다.");
    expect(onSolutionUpdated).not.toHaveBeenCalled();
  });

  it("routes update 401 through the existing session-expiry callback", async () => {
    const updateClient: DashboardSolutionUpdateClient = {
      updateSolution: vi.fn(async () => { throw new ArchiveSessionExpiredError("session expired"); }),
    };
    const onSessionExpired = vi.fn();
    render(<SolutionDetailActions solution={solution} updateClient={updateClient} onSessionExpired={onSessionExpired} />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});