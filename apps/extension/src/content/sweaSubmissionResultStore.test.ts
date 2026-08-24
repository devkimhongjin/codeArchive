import { describe, expect, it, vi } from "vitest";
import type { SweaSubmissionResultState } from "../adapters/swea/sweaSubmissionResult";
import { createSweaSubmissionResultStore } from "./sweaSubmissionResultStore";

const SOLVING_URL = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do");
const DETAIL_URL = new URL("https://swexpertacademy.com/main/code/problem/problemDetail.do");

describe("createSweaSubmissionResultStore", () => {
  it("retains the latest observed result in content-script memory for solving pages", () => {
    let emit: ((state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void) | undefined;
    const cleanup = vi.fn();
    const observe = vi.fn((_document: Document, callback: (state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void) => {
      emit = callback;
      return cleanup;
    });
    const store = createSweaSubmissionResultStore(document, SOLVING_URL, observe);

    expect(observe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ status: "none" });
    emit?.({ status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] });
    expect(store.getState()).toEqual({ status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] });
    store.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not initialize an observer for unsupported page kinds", () => {
    const observe = vi.fn();
    const store = createSweaSubmissionResultStore(document, DETAIL_URL, observe);

    expect(observe).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({ status: "none" });
  });
});
