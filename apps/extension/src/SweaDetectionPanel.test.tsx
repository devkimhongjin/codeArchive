import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SweaDetectionPanel } from "./SweaDetectionPanel";

describe("SweaDetectionPanel", () => {
  it("shows detected metadata and prefills through the callback", async () => {
    const onPrefill = vi.fn();
    render(
      <SweaDetectionPanel
        requestContext={async () => ({
          status: "connected",
          result: {
            status: "detected",
            problem: {
              platform: "SWEA",
              problemNumber: "1206",
              title: "View",
              difficulty: "D3",
              url: "https://swexpertacademy.com/main/code/problem/problemDetail.do",
            },
            warnings: [],
          },
        })}
        onPrefill={onPrefill}
      />,
    );

    expect(await screen.findByText("SWEA 문제 감지")).toBeInTheDocument();
    expect(screen.getByText("1206 · View")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "등록 폼에 채우기" }));
    expect(onPrefill).toHaveBeenCalledWith(expect.objectContaining({ platform: "SWEA", problemNumber: "1206", title: "View" }));
  });

  it("shows solving connection separately from unavailable", async () => {
    const { rerender } = render(
      <SweaDetectionPanel
        requestContext={async () => ({
          status: "connected",
          result: {
            status: "connected_page",
            platform: "SWEA",
            pageKind: "solving",
            url: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
          },
        })}
        onPrefill={() => undefined}
      />,
    );
    expect(await screen.findByText("SWEA 풀이 페이지 연결됨")).toBeInTheDocument();

    rerender(
      <SweaDetectionPanel
        requestContext={async () => ({ status: "unavailable" })}
        onPrefill={() => undefined}
      />,
    );
    expect(await screen.findByText("Content Script에 연결할 수 없습니다.")).toBeInTheDocument();
  });

  it("shows incomplete problem detail state", async () => {
    render(
      <SweaDetectionPanel
        requestContext={async () => ({ status: "connected", result: { status: "incomplete", missing: ["title"], warnings: [] } })}
        onPrefill={() => undefined}
      />,
    );
    expect(await screen.findByText("SWEA 문제 상세 페이지 연결됨")).toBeInTheDocument();
    expect(screen.getByText(/누락: title/)).toBeInTheDocument();
  });
});
