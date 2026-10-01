import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { createCapture } from "../src/capture";

test("Programmers listing owns auxiliary envelopes and the only local store", async () => {
  const { document } = parseHTML(`<html><body><button>로그아웃</button><a href="https://programmers.co.kr/users/profile"></a>
    <div class="total"><span class="text">1 문제</span></div><table><tbody><tr><td class="status solved"></td><td class="title"><a href="/learn/courses/30/lessons/389481">가장 큰 수</a></td></tr></tbody></table>
    <button data-testid="page-active">1</button><button aria-label="처음 페이지" disabled></button><button aria-label="다음 페이지" disabled></button></body></html>`);
  const location = new URL("https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1");
  const window = document.defaultView!; Object.defineProperty(window, "location", { value: location, configurable: true });
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const id = "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java";
  const capture = createCapture({ platform: "PROGRAMMERS", problemNumber: "389481", title: "가장 큰 수", problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/389481",
    language: "java", sourceCode: "class Solution {}", result: "ACCEPTED", solvedAt: "2026-09-21T16:43:28.310+09:00", observedAt: "2026-10-01T00:00:00.000Z", historicalImport: true, historicalSubmissionId: id },
  { uuid: () => "00000000-0000-4000-8000-000000000001" })!;
  const calls: unknown[] = [];
  let importResult: unknown = { ok: true, result: { status: "DONE", accountId: "947840", capture } };
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } }, sendMessage: async (message: unknown) => {
    calls.push(message); const type = (message as { type?: string }).type;
    if (type === "PROGRAMMERS_AUX_READ" && (message as { mode?: string }).mode === "preview") return { ok: true, result: { status: "READY", accountId: "947840", lessonId: "389481", title: "가장 큰 수", candidates: [{ submissionId: id, problemNumber: "389481", language: "java", createdAt: "2026-09-21T16:43:28.310+09:00", score: 100 }] } };
    if (type === "PROGRAMMERS_AUX_READ") return importResult;
    if (type === "STORE_HISTORICAL_CAPTURE") return { ok: true, created: true };
    return { ok: true };
  } }, storage: { local: { set: async () => undefined } } };
  const globals = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, MutationObserver: globalThis.MutationObserver, Element: globalThis.Element, setTimeout: globalThis.setTimeout };
  Object.assign(globalThis, { document, window, chrome, MutationObserver: window.MutationObserver, Element: window.Element,
    setTimeout: ((callback: (...args: unknown[]) => void, _delay?: number) => globals.setTimeout(callback, 1)) as typeof setTimeout });
  const message = (payload: unknown) => new Promise<unknown>(resolve => { assert.equal(listener!(payload, null, resolve), false); });
  try {
    const contentModule = "../src/content?programmers-flow";
    await import(contentModule); assert.ok(listener);
    assert.equal((await message({ type: "LOCAL_HISTORY_SCAN_START", platform: "PROGRAMMERS" }) as { status: string }).status, "SCANNING");
    await new Promise(resolve => globals.setTimeout(resolve, 30));
    const ready = await message({ type: "LOCAL_HISTORY_STATUS", platform: "PROGRAMMERS" }) as { status: string; candidates?: Array<{ submissionId: string }> };
    assert.equal(ready.status, "READY"); assert.deepEqual(ready.candidates?.map(item => item.submissionId), [id]);
    assert.equal((await message({ type: "LOCAL_HISTORY_IMPORT_START", platform: "PROGRAMMERS", submissionIds: [id] }) as { status: string }).status, "IMPORTING");
    await new Promise(resolve => globals.setTimeout(resolve, 30));
    const done = await message({ type: "LOCAL_HISTORY_STATUS", platform: "PROGRAMMERS" }) as { status: string; problemCount?: number; submissionCount?: number };
    assert.equal(done.status, "DONE"); assert.equal(done.problemCount, 1); assert.equal(done.submissionCount, 1);
    assert.equal(calls.filter(call => (call as { type?: string }).type === "STORE_HISTORICAL_CAPTURE").length, 1);
    // Account/source ownership loss from the auxiliary tab interrupts instead
    // of looking like a single unavailable detail.
    assert.equal((await message({ type: "LOCAL_HISTORY_SCAN_START", platform: "PROGRAMMERS" }) as { status: string }).status, "SCANNING");
    await new Promise(resolve => globals.setTimeout(resolve, 30));
    const refreshed = await message({ type: "LOCAL_HISTORY_STATUS", platform: "PROGRAMMERS" }) as { status: string; candidates?: Array<{ submissionId: string }> };
    assert.equal(refreshed.status, "READY");
    importResult = { ok: true, result: { status: "OWNERSHIP_UNVERIFIED" } };
    await message({ type: "LOCAL_HISTORY_IMPORT_START", platform: "PROGRAMMERS", submissionIds: [id] });
    await new Promise(resolve => globals.setTimeout(resolve, 30));
    const interrupted = await message({ type: "LOCAL_HISTORY_STATUS", platform: "PROGRAMMERS" }) as { status: string; completed?: number; saved?: number };
    assert.equal(interrupted.status, "INTERRUPTED"); assert.equal(interrupted.completed, 1); assert.equal(interrupted.saved, 0);
    assert.equal(calls.filter(call => (call as { type?: string }).type === "STORE_HISTORICAL_CAPTURE").length, 1);
  } finally { Object.assign(globalThis, globals); }
});
