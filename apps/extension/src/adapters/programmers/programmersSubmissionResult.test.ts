import { describe, expect, it, vi } from "vitest";
import { observeProgrammersSubmissionResult } from "./programmersSubmissionResult";

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const acceptedDialog = '<div id="modal-dialog" class="modal fade show" role="dialog" aria-modal="true"><h4 class="modal-title">정답입니다!</h4></div>';
const submitButton = '<button id="submit-code">제출 후 채점하기</button>';
const fixedNow = () => new Date("2026-09-01T00:30:00.000Z");

describe("observeProgrammersSubmissionResult", () => {
  it("observes the evidence-backed active accepted dialog", () => {
    const onObservation = vi.fn();
    observeProgrammersSubmissionResult(documentFrom(acceptedDialog), onObservation, fixedNow);
    expect(onObservation).toHaveBeenCalledWith({
      status: "observed",
      submission: { result: "ACCEPTED", observedAt: "2026-09-01T00:30:00.000Z" },
      warnings: [],
    });
  });

  it("does not accept sample execution, a hidden modal, or a different result title", () => {
    for (const html of [
      '<section>실행 결과<table><tr><td>테스트 1</td><td>통과</td></tr></table></section>',
      '<div id="modal-dialog" class="modal fade" role="dialog" aria-modal="false"><h4 class="modal-title">정답입니다!</h4></div>',
      '<div id="modal-dialog" class="modal fade show" role="dialog" aria-modal="true"><h4 class="modal-title">다시 시도해주세요.</h4></div>',
    ]) {
      const onObservation = vi.fn();
      observeProgrammersSubmissionResult(documentFrom(html), onObservation, fixedNow);
      expect(onObservation).not.toHaveBeenCalled();
    }
  });

  it("suppresses rerender duplicates and re-arms only after the dialog hides", async () => {
    const document = documentFrom(acceptedDialog);
    const onObservation = vi.fn();
    observeProgrammersSubmissionResult(document, onObservation, fixedNow);
    const dialog = document.querySelector("#modal-dialog")!;

    dialog.append(document.createElement("span"));
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(1);

    dialog.classList.remove("show");
    dialog.setAttribute("aria-modal", "false");
    await flushMutations();
    dialog.classList.add("show");
    dialog.setAttribute("aria-modal", "true");
    await flushMutations();
    expect(onObservation).toHaveBeenCalledTimes(2);
  });

  it("binds an external result group only when it is fresh in the accepted cycle", async () => {
    const document = documentFrom("");
    const performancePromise = new Promise<unknown>((resolve) => {
      observeProgrammersSubmissionResult(document, (_observation, cycle) => resolve(cycle?.getPerformance()));
    });
    document.body.insertAdjacentHTML("beforeend", `${acceptedDialog}<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (1ms, 2MB)</td></tr></tbody></table></div>`);
    await flushMutations();
    await expect(performancePromise).resolves.toEqual({ executionTime: "1.00 ms", memoryUsage: "2.00 MB" });
  });

  it("binds a result group that changes after final submit and before the accepted dialog", async () => {
    const document = documentFrom(`${submitButton}<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (9ms, 9MB)</td></tr></tbody></table></div>`);
    const performancePromise = new Promise<unknown>((resolve) => {
      observeProgrammersSubmissionResult(document, (_observation, cycle) => resolve(cycle?.getPerformance()));
    });

    document.querySelector("#submit-code")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector(".console-test-group tbody")!.innerHTML = '<tr><td class="result passed">통과 (2ms, 4MB)</td></tr>';
    await flushMutations();
    document.body.insertAdjacentHTML("beforeend", acceptedDialog);
    await flushMutations();

    await expect(performancePromise).resolves.toEqual({ executionTime: "2.00 ms", memoryUsage: "4.00 MB" });
  });

  it("rejects an unchanged pre-existing result group after final submit", async () => {
    vi.useFakeTimers();
    try {
      const document = documentFrom(`${submitButton}<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (1ms, 2MB)</td></tr></tbody></table></div>`);
      let cycle: any;
      observeProgrammersSubmissionResult(document, (_observation, acceptedCycle) => { cycle = acceptedCycle; });

      document.querySelector("#submit-code")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.body.insertAdjacentHTML("beforeend", acceptedDialog);
      await flushMutations();
      await vi.advanceTimersByTimeAsync(2_100);

      await expect(cycle.getPerformance()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires fresh result provenance after the latest final submit", async () => {
    vi.useFakeTimers();
    try {
      const document = documentFrom(`${submitButton}<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (9ms, 9MB)</td></tr></tbody></table></div>`);
      let cycle: any;
      observeProgrammersSubmissionResult(document, (_observation, acceptedCycle) => { cycle = acceptedCycle; });

      document.querySelector("#submit-code")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector(".console-test-group tbody")!.innerHTML = '<tr><td class="result passed">통과 (2ms, 4MB)</td></tr>';
      await flushMutations();
      document.querySelector("#submit-code")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.body.insertAdjacentHTML("beforeend", acceptedDialog);
      await flushMutations();
      await vi.advanceTimersByTimeAsync(2_100);

      await expect(cycle.getPerformance()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a valid result group that predates the accepted observation", async () => {
    vi.useFakeTimers();
    try {
      const document = documentFrom(`<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (1ms, 2MB)</td></tr></tbody></table></div>`);
      let cycle: any;
      observeProgrammersSubmissionResult(document, (_observation, acceptedCycle) => { cycle = acceptedCycle; });
      document.body.insertAdjacentHTML("beforeend", acceptedDialog);
      await flushMutations();
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(cycle.getPerformance()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows the result table to complete after modal close within the same cycle", async () => {
    const document = documentFrom("");
    let cycle: any;
    const performancePromise = new Promise<unknown>((resolve) => {
      observeProgrammersSubmissionResult(document, (_observation, acceptedCycle) => { cycle = acceptedCycle; resolve(acceptedCycle?.getPerformance()); });
    });
    document.body.insertAdjacentHTML("beforeend", `${acceptedDialog}<div class="console-content"><table class="console-test-group"><tbody></tbody></table></div>`);
    await flushMutations();
    document.querySelector("#modal-dialog")!.remove();
    document.querySelector(".console-test-group tbody")!.innerHTML = "<tr><td class=\"result passed\">통과 (2ms, 4MB)</td></tr>";
    await flushMutations();
    await expect(performancePromise).resolves.toEqual({ executionTime: "2.00 ms", memoryUsage: "4.00 MB" });
    expect(cycle).toBeDefined();
  });

  it("does not attach performance when the modal closes without a fresh result mutation", async () => {
    vi.useFakeTimers();
    try {
      const document = documentFrom(`<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (1ms, 2MB)</td></tr></tbody></table></div>`);
      let cycle: any;
      observeProgrammersSubmissionResult(document, (_observation, acceptedCycle) => { cycle = acceptedCycle; });
      document.body.insertAdjacentHTML("beforeend", acceptedDialog);
      await flushMutations();
      document.querySelector("#modal-dialog")!.remove();
      await flushMutations();
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(cycle.getPerformance()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates the previous pending cycle when another accepted cycle begins", async () => {
    const document = documentFrom("");
    const cycles: any[] = [];
    observeProgrammersSubmissionResult(document, (_observation, cycle) => { if (cycle) cycles.push(cycle); });
    document.body.insertAdjacentHTML("beforeend", acceptedDialog);
    await flushMutations();
    document.querySelector("#modal-dialog")!.remove();
    await flushMutations();
    document.body.insertAdjacentHTML("beforeend", acceptedDialog);
    await flushMutations();
    expect(cycles).toHaveLength(2);
    await expect(cycles[0].getPerformance()).resolves.toBeUndefined();
  });
});
