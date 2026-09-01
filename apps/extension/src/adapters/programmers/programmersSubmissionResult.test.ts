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
});
