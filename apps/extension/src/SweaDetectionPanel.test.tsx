import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SweaDetectionPanel } from "./SweaDetectionPanel";

const savedAutoRecord = {
  id: "swea-auto:1", platform: "SWEA", problemNumber: "1234", title: "Synthetic title", language: "Java", code: "code",
  solvedAt: "2026-08-24", aiUsage: "unknown" as const, createdAt: "2026-08-24T12:00:01.000Z", updatedAt: "2026-08-24T12:00:01.000Z",
  autoCapture: { source: "SWEA_AUTO" as const, result: "ACCEPTED" as const, observedAt: "2026-08-24T12:00:00.000Z" },
};

describe("SweaDetectionPanel", () => {
  it("shows detected problem metadata without a manual registration prefill action", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "detected", problem: { platform: "SWEA", problemNumber: "1206", title: "View", difficulty: "D3", url: "https://swexpertacademy.com/main/code/problem/problemDetail.do" }, warnings: [] } })} />);
    expect(await screen.findByText("SWEA 문제 감지")).toBeInTheDocument();
    expect(screen.getByText("1206 · View")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });

  it("keeps solving metadata, accepted result, saved provenance, and automatic-save status visible", async () => {
    render(<SweaDetectionPanel savedRecords={[savedAutoRecord]} requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, warnings: [] }, editor: { status: "detected", editor: { language: "Java", code: "public class Main {}" }, warnings: [] }, submissionResult: { status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] }, autoSave: { status: "saved", solutionId: "swea-auto:1", savedAt: "2026-08-24T12:00:01.000Z" } } })} />);
    expect(await screen.findByText("SWEA 풀이 페이지 연결됨")).toBeInTheDocument();
    expect(screen.getByText("문제: 1234 · Synthetic title")).toBeInTheDocument();
    expect(screen.getByText("언어: Java")).toBeInTheDocument();
    expect(screen.getByText("코드: 감지됨 · 20자")).toBeInTheDocument();
    expect(screen.getByText("현재 세션 제출 결과: ACCEPTED · 관찰 시각: 2026-08-24 21:00:00 KST")).toBeInTheDocument();
    expect(screen.getByText("최근 저장: PASS 자동저장")).toBeInTheDocument();
    expect(screen.getByText("자동 저장 완료")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });

  it("shows observer none as current-session detection pending", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, warnings: [] }, editor: { status: "detected", editor: { language: "Java", code: "current" }, warnings: [] }, submissionResult: { status: "none" } } })} />);
    expect(await screen.findByText("현재 세션 제출 결과: 감지 전")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });

  it("keeps incomplete metadata and detected editor informational only", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "incomplete", missing: ["problemNumber", "title"], warnings: [] }, editor: { status: "detected", editor: { language: "Java", code: "current" }, warnings: [] }, submissionResult: { status: "none" } } })} />);
    expect(await screen.findByText("문제 정보 일부 감지 실패")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });

  it("keeps identity conflicts informational only", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "conflict", warnings: ["identity mismatch"] }, editor: { status: "detected", editor: { language: "Java", code: "current" }, warnings: [] }, submissionResult: { status: "none" } } })} />);
    expect(await screen.findByText("SWEA 문제 식별 정보 불일치")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });

  it("shows editor incomplete separately from unavailable", async () => {
    const { rerender } = render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "incomplete", missing: ["problemNumber", "title"], warnings: [] }, editor: { status: "incomplete", language: "Java", code: null, missing: ["code"], warnings: [] }, submissionResult: { status: "none" } } })} />);
    expect(await screen.findByText(/코드 편집기 감지 실패/)).toBeInTheDocument();
    rerender(<SweaDetectionPanel requestContext={async () => ({ status: "unavailable" })} />);
    expect(await screen.findByText("Content Script에 연결할 수 없습니다.")).toBeInTheDocument();
  });

  it("shows latest-code sync failure without a stale prefill button", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "current" }, warnings: [] }, editor: { status: "incomplete", language: "Java", code: null, missing: ["code"], warnings: ["SWEA 편집기 최신 코드 동기화에 실패했습니다."] }, submissionResult: { status: "none" } } })} />);
    expect(await screen.findByText("최신 코드 동기화 실패")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록 폼에 채우기" })).not.toBeInTheDocument();
  });

  it("shows UNKNOWN without claiming a saved record", async () => {
    render(<SweaDetectionPanel requestContext={async () => ({ status: "connected", result: { status: "connected_page", platform: "SWEA", pageKind: "solving", url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do", metadata: { status: "incomplete", missing: ["problemNumber", "title"], warnings: [] }, editor: { status: "incomplete", language: null, code: null, missing: ["language", "code"], warnings: [] }, submissionResult: { status: "observed", submission: { result: "UNKNOWN", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: ["generic warning"] } } })} />);
    expect(await screen.findByText("현재 세션 제출 결과: UNKNOWN · 관찰 시각: 2026-08-24 21:00:00 KST")).toBeInTheDocument();
    expect(screen.queryByText(/저장 완료/)).not.toBeInTheDocument();
  });
});
