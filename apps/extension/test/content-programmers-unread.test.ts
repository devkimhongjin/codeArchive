import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

const lessonIds = ["101", "102", "103", "104", "105"];
const listing = () => `<html><body><button>로그아웃</button><a href="https://programmers.co.kr/users/profile"></a>
  <div class="total"><span class="text">${lessonIds.length} 문제</span></div><table><tbody>${lessonIds.map(id =>
    `<tr><td class="status solved"></td><td class="title"><a href="/learn/courses/30/lessons/${id}">문제 ${id}</a></td></tr>`).join("")}</tbody></table>
  <button data-testid="page-active">1</button><button aria-label="처음 페이지" disabled></button><button aria-label="다음 페이지" disabled></button></body></html>`;
const ready = (lessonId: string) => ({ ok: true, result: { status: "READY", accountId: "947840", lessonId, title: `문제 ${lessonId}`,
  candidates: [{ submissionId: `pg:947840:${lessonId}:2026-09-21T16:43:28.310+09:00:java`, problemNumber: lessonId, language: "java", createdAt: "2026-09-21T16:43:28.310+09:00", score: 100 }] } });

test("a Programmers scan retries an unreadable lesson once, leaves it out, and stops only after several in a row", async () => {
  const { document } = parseHTML(listing());
  const location = new URL("https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1");
  const window = document.defaultView!; Object.defineProperty(window, "location", { value: location, configurable: true });
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  let answers: Record<string, Array<unknown | Error>> = {};
  const reads: string[] = [];
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } }, sendMessage: async (message: unknown) => {
    const { type, lessonUrl } = message as { type?: string; lessonUrl?: string };
    if (type !== "PROGRAMMERS_AUX_READ") return { ok: true };
    const lessonId = lessonUrl!.split("/").pop()!; reads.push(lessonId);
    const answer = answers[lessonId]?.shift() ?? ready(lessonId);
    if (answer instanceof Error) throw answer;
    return answer;
  } }, storage: { local: { set: async () => undefined } } };
  const globals = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, MutationObserver: globalThis.MutationObserver, Element: globalThis.Element, setTimeout: globalThis.setTimeout };
  Object.assign(globalThis, { document, window, chrome, MutationObserver: window.MutationObserver, Element: window.Element,
    setTimeout: ((callback: (...args: unknown[]) => void, _delay?: number) => globals.setTimeout(callback, 1)) as typeof setTimeout });
  const message = (payload: unknown) => new Promise<unknown>(resolve => { assert.equal(listener!(payload, null, resolve), false); });
  const scan = async () => {
    reads.length = 0;
    assert.equal((await message({ type: "LOCAL_HISTORY_SCAN_START", platform: "PROGRAMMERS" }) as { status: string }).status, "SCANNING");
    await new Promise(resolve => globals.setTimeout(resolve, 40));
    return await message({ type: "LOCAL_HISTORY_STATUS", platform: "PROGRAMMERS" }) as { status: string; candidates?: Array<{ problemNumber: string }>; unreadProblemNumbers?: string[]; failedProblemNumber?: string };
  };
  try {
    const contentModule = "../src/content?programmers-unread";
    await import(contentModule); assert.ok(listener);

    // 102 times out once and is read on the retry; 103 fails twice (a lost
    // message, then a history panel that did not finish) and is left out.
    answers = { "102": [{ ok: false, error: "READ_TIMEOUT" }], "103": [new Error("message port closed"), { ok: true, result: { status: "HISTORY_INCOMPLETE" } }],
      "104": [{ ok: true, result: { status: "EMPTY", accountId: "947840", lessonId: "104", title: "문제 104", candidates: [] } }] };
    const partial = await scan();
    assert.equal(partial.status, "READY");
    assert.deepEqual(partial.unreadProblemNumbers, ["103"]);
    assert.deepEqual(partial.candidates?.map(candidate => candidate.problemNumber), ["101", "102", "105"]);
    assert.deepEqual(reads, ["101", "102", "102", "103", "103", "104", "105"]);

    // Three unreadable lessons in a row end the scan at the third one; the
    // remaining lesson is not opened.
    const failing = { ok: true, result: { status: "OWNERSHIP_UNVERIFIED" } };
    answers = { "102": [failing, failing], "103": [failing, failing], "104": [failing, failing] };
    const stopped = await scan();
    assert.equal(stopped.status, "SCAN_INCOMPLETE");
    assert.equal(stopped.failedProblemNumber, "104");
    assert.equal(reads.includes("105"), false);

    // A source tab change still interrupts instead of skipping the lesson.
    answers = { "101": [{ ok: false, error: "REDIRECTED" }] };
    assert.equal((await scan()).status, "INTERRUPTED");
    assert.deepEqual(reads, ["101"]);
  } finally { Object.assign(globalThis, globals); }
});
