import { describe, expect, it, vi } from "vitest";
import { SAVE_ACCEPTED_CAPTURE } from "./acceptedCapture";
import { captureProgrammersAccepted } from "./programmersAutoCapture";

const url = new URL("https://school.programmers.co.kr/learn/courses/30/lessons/42842?language=java");
const accepted = { status: "observed" as const, submission: { result: "ACCEPTED" as const, observedAt: "2026-09-01T00:30:00.000Z" }, warnings: [] };
function doc(html = '<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code">class Solution {}</textarea>'): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("captureProgrammersAccepted", () => {
  it("freezes the evidence-backed accepted source and sends it to local persistence", async () => {
    const send = vi.fn(async () => ({ status: "saved" as const, solutionId: "programmers-auto:uuid", savedAt: "2026-09-01T00:30:01.000Z" }));
    await expect(captureProgrammersAccepted(doc(), url, accepted, send, () => "uuid")).resolves.toMatchObject({ status: "saved" });
    expect(send).toHaveBeenCalledWith({
      type: SAVE_ACCEPTED_CAPTURE,
      capture: expect.objectContaining({
        captureId: "uuid",
        platform: "PROGRAMMERS",
        problemNumber: "42842",
        title: "카펫",
        language: "Java",
        code: "class Solution {}",
        result: "ACCEPTED",
        problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/42842",
      }),
    });
  });

  it("fails closed for untrusted metadata, missing editor, empty code, and channel loss", async () => {
    const send = vi.fn();
    await expect(captureProgrammersAccepted(doc(), new URL("https://example.com/learn/courses/30/lessons/42842"), accepted, send)).resolves.toMatchObject({ reason: "metadata_untrusted" });
    await expect(captureProgrammersAccepted(doc('<div class="challenge-title">카펫</div>'), url, accepted, send)).resolves.toMatchObject({ reason: "editor_incomplete" });
    await expect(captureProgrammersAccepted(doc('<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code"></textarea>'), url, accepted, send)).resolves.toMatchObject({ reason: "empty_code" });
    await expect(captureProgrammersAccepted(doc(), url, accepted, async () => { throw new Error("closed"); })).resolves.toMatchObject({ reason: "confirmation_unknown" });
    expect(send).not.toHaveBeenCalled();
  });
});
