import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BetaEntryGate } from "./BetaEntryGate";
import type { EntryResult } from "./betaEntry";

function entry(accepted = false) { return { accepted: () => accepted, remember: vi.fn() }; }
function submit(password = "synthetic-password") {
  fireEvent.change(screen.getByLabelText("초대 비밀번호"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard 입장" }));
}

describe("Dashboard beta entry screen", () => {
  it("does not mount account/extension effects before entry, then opens only on acceptance", async () => {
    const mounted = vi.fn();
    function Dashboard() { useEffect(mounted, []); return <div>archive content</div>; }
    const store = entry();
    const check = vi.fn(async () => "accepted" as const);
    render(<BetaEntryGate entry={store} check={check}><Dashboard /></BetaEntryGate>);
    expect(mounted).not.toHaveBeenCalled();
    expect(screen.queryByText("archive content")).not.toBeInTheDocument();
    submit();
    expect(await screen.findByText("archive content")).toBeInTheDocument();
    await waitFor(() => expect(mounted).toHaveBeenCalledTimes(1));
    expect(store.remember).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledExactlyOnceWith("synthetic-password", expect.any(AbortSignal));
  });

  it("does not recheck a tab that already passed", () => {
    const check = vi.fn();
    render(<BetaEntryGate entry={entry(true)} check={check}>archive content</BetaEntryGate>);
    expect(screen.getByText("archive content")).toBeInTheDocument();
    expect(screen.queryByLabelText("초대 비밀번호")).not.toBeInTheDocument();
    expect(check).not.toHaveBeenCalled();
  });

  it.each(["incorrect", "unavailable"] as const)("keeps screen locked after %s and clears input", async (result) => {
    const store = entry();
    render(<BetaEntryGate entry={store} check={async () => result}>archive content</BetaEntryGate>);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(result === "incorrect" ? "비밀번호가 맞지" : "지금은 입장을 확인");
    expect(screen.getByLabelText("초대 비밀번호")).toHaveValue("");
    expect(screen.queryByText("archive content")).not.toBeInTheDocument();
    expect(store.remember).not.toHaveBeenCalled();
  });

  it("blocks empty and duplicate submissions while checking", async () => {
    let resolve!: (result: EntryResult) => void;
    const check = vi.fn(() => new Promise<EntryResult>((done) => { resolve = done; }));
    render(<BetaEntryGate entry={entry()} check={check}>archive content</BetaEntryGate>);
    expect(screen.getByRole("button", { name: "Dashboard 입장" })).toBeDisabled();
    submit();
    fireEvent.click(screen.getByRole("button", { name: "확인 중…" }));
    expect(check).toHaveBeenCalledTimes(1);
    resolve("incorrect");
    await screen.findByRole("alert");
  });

  it("aborts an in-flight check on unmount without remembering approval", async () => {
    let resolve!: (result: EntryResult) => void;
    const store = entry();
    const check = vi.fn((_password: string, _signal?: AbortSignal) => new Promise<EntryResult>((done) => { resolve = done; }));
    const view = render(<BetaEntryGate entry={store} check={check}>archive content</BetaEntryGate>);
    submit();
    view.unmount();
    expect(check.mock.calls[0][1]?.aborted).toBe(true);
    resolve("accepted");
    await waitFor(() => expect(store.remember).not.toHaveBeenCalled());
  });
});
