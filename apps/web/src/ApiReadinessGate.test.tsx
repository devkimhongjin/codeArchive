import { StrictMode, useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiReadinessGate } from "./ApiReadinessGate";
import { BetaEntryGate } from "./BetaEntryGate";
import { createReadinessCheck, type ReadinessResult } from "./apiReadiness";

afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: (result: ReadinessResult) => void;
  const check = vi.fn((_signal: AbortSignal) => new Promise<ReadinessResult>((done) => { resolve = done; }));
  return { check, resolve: (result: ReadinessResult) => resolve(result) };
}

describe("API readiness before beta entry and Dashboard effects", () => {
  it.each([false, true])("does not mount account/bridge effects early, including accepted tab=%s", async (accepted) => {
    const mounted = vi.fn();
    function Dashboard() { useEffect(() => { mounted(); }, []); return <div>archive</div>; }
    const ready = deferred();
    const checkEntry = vi.fn(async () => "accepted" as const);
    render(<ApiReadinessGate check={ready.check}><BetaEntryGate check={checkEntry}
      entry={{ accepted: () => accepted, remember: vi.fn() }}><Dashboard /></BetaEntryGate></ApiReadinessGate>);
    expect(mounted).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("초대 비밀번호")).not.toBeInTheDocument();
    await act(async () => ready.resolve({ status: "ready" }));
    expect(checkEntry).not.toHaveBeenCalled();
    if (!accepted) {
      expect(mounted).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("초대 비밀번호"), { target: { value: "synthetic-only" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dashboard 입장" })));
    }
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("shows elapsed time and cancels without allowing late success to open children", async () => {
    vi.useFakeTimers();
    const intervals = vi.spyOn(globalThis, "setInterval");
    const clearInterval = vi.spyOn(globalThis, "clearInterval");
    const ready = deferred();
    render(<ApiReadinessGate check={ready.check}>archive</ApiReadinessGate>);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText("경과 5초 / 최대 120초")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "대기 취소" }));
    expect(ready.check.mock.calls[0][0].aborted).toBe(true);
    expect(screen.getByRole("button", { name: "다시 확인" })).toHaveFocus();
    await act(async () => ready.resolve({ status: "ready" }));
    expect(screen.queryByText("archive")).not.toBeInTheDocument();
    expect(clearInterval).toHaveBeenCalledWith(intervals.mock.results[0].value);
    intervals.mockRestore();
    clearInterval.mockRestore();
  });

  it("a previous attempt cannot open the screen or cancel a newer retry", async () => {
    const old = deferred();
    const next = deferred();
    const check = vi.fn().mockImplementationOnce(old.check).mockImplementationOnce(next.check);
    render(<ApiReadinessGate check={check}>archive</ApiReadinessGate>);
    fireEvent.click(screen.getByRole("button", { name: "대기 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await act(async () => old.resolve({ status: "ready" }));
    expect(screen.queryByText("archive")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "대기 취소" }));
    expect(next.check.mock.calls[0][0].aborted).toBe(true);
  });

  it("stops at the real client deadline; manual retry can then succeed", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(() => undefined));
    const check = createReadinessCheck(fetcher);
    render(<ApiReadinessGate check={check}>archive</ApiReadinessGate>);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(screen.getByRole("status")).toHaveTextContent("네트워크");
    expect(screen.queryByRole("button", { name: "대기 취소" })).not.toBeInTheDocument();
    const count = fetcher.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(fetcher).toHaveBeenCalledTimes(count);
    fetcher.mockImplementation(async () => new Response('{"status":"UP"}'));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 확인" })));
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["network", "server", "response"] as const)("explains %s failures separately from password rejection", async (reason) => {
    const check = vi.fn(async () => ({ status: "unavailable" as const, reason }));
    render(<ApiReadinessGate check={check}>archive</ApiReadinessGate>);
    expect(await screen.findByRole("button", { name: "다시 확인" })).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent("비밀번호가 맞지");
    expect(screen.queryByText("archive")).not.toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("aborts StrictMode cleanup and unmount, ignoring late results", async () => {
    const checks: ReturnType<typeof deferred>[] = [];
    const check = vi.fn((signal: AbortSignal) => {
      const request = deferred(); checks.push(request); return request.check(signal);
    });
    const view = render(<StrictMode><ApiReadinessGate check={check}>archive</ApiReadinessGate></StrictMode>);
    expect(check.mock.calls[0][0].aborted).toBe(true);
    await act(async () => checks[0].resolve({ status: "ready" }));
    expect(screen.queryByText("archive")).not.toBeInTheDocument();
    view.unmount();
    expect(check.mock.calls[1][0].aborted).toBe(true);
    await act(async () => checks[1].resolve({ status: "ready" }));
  });
});
