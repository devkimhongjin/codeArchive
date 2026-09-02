import { describe, expect, it, vi } from "vitest";
import { mapSweaVisibleSubmissionResult, observeSweaSubmissionResult } from "./sweaSubmissionResult";

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const fixedNow = () => new Date("2026-08-24T12:00:00.000Z");

describe("sweaSubmissionResult", () => {
  it("normalizes the evidence-backed accepted phrase", () => {
    expect(mapSweaVisibleSubmissionResult("  PASS입니다.  ", fixedNow())).toEqual({
      status: "observed",
      submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" },
      warnings: [],
    });
  });

  it("maps a non-empty unrecognized visible result to UNKNOWN without retaining text", () => {
    expect(mapSweaVisibleSubmissionResult("unrecognized synthetic result", fixedNow())).toEqual({
      status: "observed",
      submission: { result: "UNKNOWN", observedAt: "2026-08-24T12:00:00.000Z" },
      warnings: ["SWEA 제출 결과를 표준 코드로 식별하지 못했습니다."],
    });
    expect(mapSweaVisibleSubmissionResult("   ", fixedNow())).toBeNull();
  });

  it("observes an initially visible popup once", () => {
    const onObservation = vi.fn();
    const document = documentFrom('<div class="popup_layer show"><div><p class="txt">Pass입니다.</p></div></div>');

    observeSweaSubmissionResult(document, onObservation, fixedNow);

    expect(onObservation).toHaveBeenCalledTimes(1);
    expect(onObservation).toHaveBeenCalledWith(expect.objectContaining({ submission: expect.objectContaining({ result: "ACCEPTED" }) }));
  });

  it("observes inserted and class-shown popups, but not hidden, missing, or empty results", async () => {
    const onObservation = vi.fn();
    const document = documentFrom("");
    observeSweaSubmissionResult(document, onObservation, fixedNow);

    expect(onObservation).not.toHaveBeenCalled();
    const inserted = document.createElement("div");
    inserted.className = "popup_layer show";
    inserted.innerHTML = '<div><p class="txt">Pass입니다.</p></div>';
    document.body.append(inserted);
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(1);

    const classShown = document.createElement("div");
    classShown.className = "popup_layer";
    classShown.innerHTML = '<div><p class="txt">Pass입니다.</p></div>';
    document.body.append(classShown);
    inserted.classList.remove("show");
    await flushMutations();
    classShown.classList.add("show");
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(2);

    classShown.classList.remove("show");
    await flushMutations();
    classShown.querySelector(".txt")!.textContent = "";
    classShown.classList.add("show");
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(2);
  });

  it("suppresses repeats in one visible cycle and re-arms after the popup hides", async () => {
    const onObservation = vi.fn();
    const document = documentFrom('<div class="popup_layer show"><div><p class="txt">Pass입니다.</p></div></div>');
    const cleanup = observeSweaSubmissionResult(document, onObservation, fixedNow);
    const popup = document.querySelector(".popup_layer") as HTMLElement;

    document.body.append(document.createElement("span"));
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(1);

    popup.classList.remove("show");
    await flushMutations();
    popup.classList.add("show");
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(2);

    cleanup();
    popup.classList.remove("show");
    popup.classList.add("show");
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(2);
  });

  it("recognizes a new PASS when the same popup node is reused after a non-PASS transition", async () => {
    const onObservation = vi.fn();
    const document = documentFrom('<div class="popup_layer show"><div><p class="txt">Pass입니다.</p></div></div>');
    const cleanup = observeSweaSubmissionResult(document, onObservation, fixedNow);
    const text = document.querySelector(".txt")!;

    text.textContent = "제출 중입니다.";
    await flushMutations();
    text.textContent = "Pass입니다.";
    await flushMutations();

    expect(onObservation).toHaveBeenCalledTimes(3);
    expect(onObservation.mock.calls.filter(([value]) => value.submission.result === "ACCEPTED")).toHaveLength(2);
    cleanup();
  });
});
