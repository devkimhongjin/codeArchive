import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSolution } from "./archiveTypes";
import { SolutionDetailActions } from "./SolutionDetailActions";

const solution: DashboardSolution = {
  id: "solution-1",
  platform: "SWEA",
  problemNumber: "1206",
  title: "View",
  language: "Java",
  code: "class Main {}",
  solvedAt: "2026-08-30",
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
});
