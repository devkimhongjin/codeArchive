import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SweaDetectionPanel } from "./SweaDetectionPanel";

const noop = () => undefined;

describe("SweaDetectionPanel", () => {
  it("shows detected metadata and prefills through the callback", async () => {
    const onProblemPrefill = vi.fn();
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "detected", problem: { platform: "SWEA", problemNumber: "1206", title: "View", difficulty: "D3", url: "https://swexpertacademy.com/main/code/problem/problemDetail.do" }, warnings: [] } })} onProblemPrefill={onProblemPrefill} onEditorPrefill={noop} onSolvingPrefill={noop} />);
    expect(await screen.findByText("SWEA 문제 감지")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "등록 폼에 채우기" }));
    expect(onProblemPrefill).toHaveBeenCalledWith(expect.objectContaining({ problemNumber: "1206", title: "View" }));
  });

  it("shows combined solving metadata and prefills all trusted fields", async () => {
    const onEditorPrefill = vi.fn();
    const onSolvingPrefill = vi.fn();
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, warnings: [] }, editor: { status: "detected", editor: { language: "Java", code: "public class Main {}" }, warnings: [] } } })} onProblemPrefill={noop} onEditorPrefill={onEditorPrefill} onSolvingPrefill={onSolvingPrefill} />);
    expect(await screen.findByText("SWEA 풀이 페이지 연결됨")).toBeInTheDocument();
    expect(screen.getByText("문제: 1234 · Synthetic title")).toBeInTheDocument();
    expect(screen.getByText("언어: Java")).toBeInTheDocument();
    expect(screen.getByText("코드: 감지됨 · 20자")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "등록 폼에 채우기" }));
    expect(onSolvingPrefill).toHaveBeenCalledWith({ problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, { language: "Java", code: "public class Main {}" });
    expect(onEditorPrefill).not.toHaveBeenCalled();
  });

  it("keeps editor-only prefill when metadata is incomplete", async () => {
    const onEditorPrefill = vi.fn();
    const onSolvingPrefill = vi.fn();
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "incomplete", missing: ["problemNumber", "title"], warnings: [] }, editor: { status: "detected", editor: { language: "Java", code: "current" }, warnings: [] } } })} onProblemPrefill={noop} onEditorPrefill={onEditorPrefill} onSolvingPrefill={onSolvingPrefill} />);
    expect(await screen.findByText("문제 정보 일부 감지 실패")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "등록 폼에 채우기" }));
    expect(onEditorPrefill).toHaveBeenCalledWith({ language: "Java", code: "current" });
    expect(onSolvingPrefill).not.toHaveBeenCalled();
  });

  it("blocks problem metadata prefill when solving identities conflict", async () => {
    const onEditorPrefill = vi.fn();
    const onSolvingPrefill = vi.fn();
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "conflict", warnings: ["identity mismatch"] }, editor: { status: "detected", editor: { language: "Java", code: "current" }, warnings: [] } } })} onProblemPrefill={noop} onEditorPrefill={onEditorPrefill} onSolvingPrefill={onSolvingPrefill} />);
    expect(await screen.findByText("SWEA 문제 식별 정보 불일치")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "등록 폼에 채우기" }));
    expect(onEditorPrefill).toHaveBeenCalledWith({ language: "Java", code: "current" });
    expect(onSolvingPrefill).not.toHaveBeenCalled();
  });

  it("shows editor incomplete separately from unavailable", async () => {
    const { rerender } = render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "incomplete", missing: ["problemNumber", "title"], warnings: [] }, editor: { status: "incomplete", language: "Java", code: null, missing: ["code"], warnings: [] } } })} onProblemPrefill={noop} onEditorPrefill={noop} onSolvingPrefill={noop} />);
    expect(await screen.findByText(/코드 편집기 감지 실패/)).toBeInTheDocument();
    rerender(<SweaDetectionPanel requestContext={async () => ({ status: "unavailable" })} onProblemPrefill={noop} onEditorPrefill={noop} onSolvingPrefill={noop} />);
    expect(await screen.findByText("Content Script에 연결할 수 없습니다.")).toBeInTheDocument();
  });

  it("shows latest-code sync failure without a stale prefill button", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, warnings: [] }, editor: { status: "incomplete", language: "Java", code: null, missing: ["code"], warnings: ["SWEA 편집기 최신 코드 동기화에 실패했습니다."] } } })} onProblemPrefill={noop} onEditorPrefill={noop} onSolvingPrefill={noop} />);
    expect(await screen.findByText("최신 코드 동기화 실패")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });
});
