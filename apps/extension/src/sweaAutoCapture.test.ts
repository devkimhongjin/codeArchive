import { describe, expect, it, vi } from "vitest";
import { captureAccepted, SAVE_SWEA_ACCEPTED, waitForSweaSubmissionPerformance } from "./sweaAutoCapture";

const url = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");
const accepted = { status: "observed" as const, submission: { result: "ACCEPTED" as const, observedAt: "2026-08-25T01:11:00.000Z" }, warnings: [] };
const historyRow = `<div class="problem_smt"><div class="submitter"><dl class="smt_txt"><dt>#Beginner</dt><dd>제출일 : 2026-08-25 10:10</dd></dl></div><div class="info"><ul><li><span>Java</span><span>언어</span></li><li><span>12,345 kb</span><span>메모리</span></li><li><span>67 ms</span><span>시간</span></li><li><span>6 Bytes</span><span>코드길이</span></li><li><span>Pass</span><span>결과</span></li></ul></div></div>`;
const history = `<header><span class="name">Beginner</span></header><form id="contestProbForm"><div class="box-list"><div class="box-list-inner">${historyRow}</div></div></form>`;
const emptyHistory = `<header><span class="name">Beginner</span></header><form id="contestProbForm"><div class="box-list"><div class="box-list-inner"></div></div></form>`;
function doc(extra = history): Document { return new DOMParser().parseFromString(`<div class="problem_box"><h3>1234. Synthetic title</h3></div><input id="contestProbId" value="current"><select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource">latest</textarea>${extra}`, "text/html"); }

describe("captureAccepted", () => {
  it("sends one accepted capture with trusted performance after metadata and editor sync", async () => {
    const send = vi.fn<(message: unknown) => Promise<any>>(async () => ({ status: "saved" as const, solutionId: "swea-auto:uuid", savedAt: "2026-08-25T01:11:01.000Z" }));
    await expect(captureAccepted(doc(), url, accepted, send, () => "uuid", () => ({ status: "synced" }))).resolves.toMatchObject({ status: "saved", solutionId: "swea-auto:uuid" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ type: SAVE_SWEA_ACCEPTED, capture: { captureId: "uuid", code: "latest", result: "ACCEPTED", performance: { memoryUsage: "12,345 kb", executionTime: "67 ms" } } });
  });

  it("waits for a delayed trusted history row and preserves its exact performance strings", async () => {
    const document = doc(emptyHistory);
    const send = vi.fn<(message: unknown) => Promise<any>>(async () => ({ status: "saved" as const, solutionId: "swea-auto:uuid", savedAt: "2026-08-25T01:11:01.000Z" }));
    setTimeout(() => {
      document.querySelector(".box-list-inner")?.insertAdjacentHTML("beforeend", historyRow);
    }, 5);

    await captureAccepted(document, url, accepted, send, () => "uuid", () => ({ status: "synced" }), 100);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ capture: { performance: { memoryUsage: "12,345 kb", executionTime: "67 ms" } } });
  });

  it("times out bounded performance waiting but still saves the ACCEPTED source", async () => {
    const send = vi.fn<(message: unknown) => Promise<any>>(async () => ({ status: "saved" as const, solutionId: "swea-auto:uuid", savedAt: "2026-08-25T01:11:01.000Z" }));
    await captureAccepted(doc(emptyHistory), url, accepted, send, () => "uuid", () => ({ status: "synced" }), 10);
    expect(send.mock.calls[0][0]).toMatchObject({ capture: { result: "ACCEPTED", code: "latest" } });
    expect((send.mock.calls[0][0] as any).capture.performance).toBeUndefined();
  });

  it("does not wait through identity failure or ambiguity", async () => {
    const identityUnavailable = doc(`<form id="contestProbForm"><div class="box-list"><div class="box-list-inner"></div></div></form>`);
    await expect(waitForSweaSubmissionPerformance(identityUnavailable, accepted.submission.observedAt, 100)).resolves.toEqual({ status: "incomplete", reason: "identity_unavailable" });

    const ambiguous = doc(`<header><span class="name">Beginner</span></header><form id="contestProbForm"><div class="box-list"><div class="box-list-inner">${historyRow}${historyRow}</div></div></form>`);
    await expect(waitForSweaSubmissionPerformance(ambiguous, accepted.submission.observedAt, 100)).resolves.toEqual({ status: "incomplete", reason: "ambiguous_candidate" });
  });

  it("still saves ACCEPTED source when performance is unavailable", async () => {
    const send = vi.fn<(message: unknown) => Promise<any>>(async () => ({ status: "saved" as const, solutionId: "swea-auto:uuid", savedAt: "2026-08-25T01:11:01.000Z" }));
    await captureAccepted(doc(""), url, accepted, send, () => "uuid", () => ({ status: "synced" }), 0);
    expect(send.mock.calls[0][0]).toMatchObject({ capture: { result: "ACCEPTED", code: "latest" } });
    expect((send.mock.calls[0][0] as any).capture.performance).toBeUndefined();
  });

  it("fails closed for unknown, untrusted metadata, stale sync, and channel loss", async () => {
    const send = vi.fn();
    await expect(captureAccepted(doc(), url, { ...accepted, submission: { ...accepted.submission, result: "UNKNOWN" } }, send)).resolves.toEqual({ status: "idle" });
    const broken = new DOMParser().parseFromString("<main/>", "text/html");
    await expect(captureAccepted(broken, url, accepted, send)).resolves.toMatchObject({ reason: "metadata_untrusted" });
    await expect(captureAccepted(doc(), url, accepted, send)).resolves.toMatchObject({ reason: "editor_sync_failed" });
    await expect(captureAccepted(doc(), url, accepted, async () => { throw new Error("closed"); }, undefined, () => ({ status: "synced" }))).resolves.toMatchObject({ reason: "confirmation_unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("maps worker rejection and storage failure without false success", async () => {
    await expect(captureAccepted(doc(), url, accepted, async () => ({ status: "rejected", reason: "idempotency_conflict" }), () => "uuid", () => ({ status: "synced" }))).resolves.toMatchObject({ reason: "idempotency_conflict" });
    await expect(captureAccepted(doc(), url, accepted, async () => ({ status: "failed", reason: "storage_failed" }), () => "uuid", () => ({ status: "synced" }))).resolves.toMatchObject({ reason: "storage_failed" });
  });
});
