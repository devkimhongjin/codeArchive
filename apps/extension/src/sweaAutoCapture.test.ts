import { describe, expect, it, vi } from "vitest";
import { captureAccepted, SAVE_SWEA_ACCEPTED } from "./sweaAutoCapture";

const url = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");
const accepted = { status: "observed" as const, submission: { result: "ACCEPTED" as const, observedAt: "2026-08-24T12:00:00.000Z" }, warnings: [] };
function doc(html = '<div class="problem_box"><h3>1234. Synthetic title</h3></div><input id="contestProbId" value="current"><select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource">latest</textarea>'): Document { return new DOMParser().parseFromString(html, "text/html"); }

describe("captureAccepted", () => {
  it("sends exactly one frozen capture only after trusted accepted metadata and sync", async () => {
    const send = vi.fn<(message: unknown) => Promise<any>>(async () => ({ status: "saved" as const, solutionId: "swea-auto:uuid", savedAt: "2026-08-24T12:00:01.000Z" }));
    await expect(captureAccepted(doc(), url, accepted, send, () => "uuid", () => ({ status: "synced" }))).resolves.toMatchObject({ status: "saved", solutionId: "swea-auto:uuid" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ type: SAVE_SWEA_ACCEPTED, capture: { captureId: "uuid", code: "latest", result: "ACCEPTED", problemUrl: url.href } });
  });
  it("fails closed for unknown, untrusted metadata, stale sync, and channel loss", async () => {
    const send = vi.fn();
    await expect(captureAccepted(doc(), url, { ...accepted, submission: { ...accepted.submission, result: "UNKNOWN" } }, send)).resolves.toEqual({ status: "idle" });
    await expect(captureAccepted(doc("<main/>"), url, accepted, send)).resolves.toMatchObject({ reason: "metadata_untrusted" });
    await expect(captureAccepted(doc(), url, accepted, send)).resolves.toMatchObject({ reason: "editor_sync_failed" });
    await expect(captureAccepted(doc(), url, accepted, async () => { throw new Error("closed"); }, undefined, () => ({ status: "synced" }))).resolves.toMatchObject({ reason: "confirmation_unknown" });
    expect(send).not.toHaveBeenCalled();
  });
  it("maps worker rejection and storage failure without false success", async () => {
    await expect(captureAccepted(doc(), url, accepted, async () => ({ status: "rejected", reason: "idempotency_conflict" }), () => "uuid", () => ({ status: "synced" }))).resolves.toMatchObject({ reason: "idempotency_conflict" });
    await expect(captureAccepted(doc(), url, accepted, async () => ({ status: "failed", reason: "storage_failed" }), () => "uuid", () => ({ status: "synced" }))).resolves.toMatchObject({ reason: "storage_failed" });
  });
});
