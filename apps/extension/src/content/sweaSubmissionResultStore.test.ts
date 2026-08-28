import { describe, expect, it, vi } from "vitest";
import type { SweaSubmissionResultState } from "../adapters/swea/sweaSubmissionResult";
import { createSweaSubmissionResultStore } from "./sweaSubmissionResultStore";

const SOLVING_URL = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do");
const DETAIL_URL = new URL("https://swexpertacademy.com/main/code/problem/problemDetail.do");

function solvingDocument(contestProbId = "current"): Document {
  return new DOMParser().parseFromString(
    `<div class="problem_box"><h3>1234. Synthetic title</h3></div><input name="contestProbId" value="${contestProbId}">`,
    "text/html",
  );
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

describe("createSweaSubmissionResultStore", () => {
  it("retains the latest observed result and restores it for the same contestProbId", () => {
    let emit: ((state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void) | undefined;
    const cleanup = vi.fn();
    const observe = vi.fn((_document: Document, callback: (state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void) => {
      emit = callback;
      return cleanup;
    });
    const storage = memoryStorage();
    const document = solvingDocument();
    const store = createSweaSubmissionResultStore(document, SOLVING_URL, observe, undefined, storage);

    expect(store.getState()).toEqual({ status: "none" });
    emit?.({ status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] });
    expect(store.getState()).toMatchObject({ status: "observed", submission: { result: "ACCEPTED" } });

    const restored = createSweaSubmissionResultStore(document, SOLVING_URL, vi.fn(() => () => undefined), undefined, storage);
    expect(restored.getState()).toMatchObject({ status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" } });
  });

  it("does not restore a cached result for a different contestProbId", () => {
    const storage = memoryStorage();
    let emit: ((state: Extract<SweaSubmissionResultState, { status: "observed" }>) => void) | undefined;
    createSweaSubmissionResultStore(solvingDocument("first"), SOLVING_URL, (_document, callback) => { emit = callback; return () => undefined; }, undefined, storage);
    emit?.({ status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] });

    const other = createSweaSubmissionResultStore(solvingDocument("second"), SOLVING_URL, vi.fn(() => () => undefined), undefined, storage);
    expect(other.getState()).toEqual({ status: "none" });
  });

  it("does not initialize an observer for unsupported page kinds", () => {
    const observe = vi.fn();
    const store = createSweaSubmissionResultStore(document, DETAIL_URL, observe, undefined, memoryStorage());

    expect(observe).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({ status: "none" });
  });
});
