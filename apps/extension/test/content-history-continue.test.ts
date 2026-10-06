import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

test("production import skips a rejected detail, stores the next submission, and stops on source navigation", async () => {
  const row = (id: number) => `<tr><td data-col="번호"><span class="sl-id">${id}</span></td>
    <td data-col="제출자"><a href="/account/9">mine</a></td><td data-col="문제"><a href="/problem/${id}">Fixture #${id}</a></td>
    <td data-col="결과">정답 <span>100점</span></td><td data-col="코드 길이">5B</td>
    <td data-col="언어"><a href="?sid=${id}">Java 8</a></td></tr>`;
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/9">@mine</a>
    <a href="/account/9/edit">정보 수정</a><a class="active" href="/account/9/submission">제출현황</a>
    <table>${row(2001)}</table><button id="more">더 불러오기</button></body></html>`);
  const location = new URL("https://jungol.co.kr/account/9/submission");
  const window = document.defaultView!;
  Object.defineProperty(window, "location", { value: location, configurable: true });
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const stored: string[] = [], opened: string[] = [];
  let navigate = false, storeFailure = false, closeBlocked = false;
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } },
    sendMessage: async (message: { type: string; capture: { historicalSubmissionId: string } }) => {
      assert.equal(message.type, "STORE_HISTORICAL_CAPTURE");
      if (storeFailure) return { ok: false, error: "STORAGE_ERROR" };
      stored.push(message.capture.historicalSubmissionId); return { ok: true, created: true };
    } } };
  const globals = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome,
    MutationObserver: globalThis.MutationObserver, Element: globalThis.Element, setTimeout: globalThis.setTimeout };
  Object.assign(globalThis, { document, window, chrome, MutationObserver: window.MutationObserver, Element: window.Element,
    setTimeout: ((callback: (...args: unknown[]) => void, delay?: number) => globals.setTimeout(callback, Math.min(delay ?? 0, 5))) as typeof setTimeout });
  function attachDetails() {
    for (const link of document.querySelectorAll('td[data-col="언어"] a')) link.addEventListener("click", event => {
      event.preventDefault();
      const id = link.getAttribute("href")!.slice(5); opened.push(id);
      if (navigate) { location.pathname = "/account/10/submission"; return; }
      const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "제출 상세");
      dialog.innerHTML = `<span class="sd-id">#${id}</span><span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span>
        <a href="/account/9">${id === "2001" ? "other" : "mine"}</a><a href="/problem/${id}">Fixture #${id}</a>
        <span class="sd-meta-item"><div role="button"><span class="time">어제</span></div></span><code class="hljs">hello</code><button>닫기</button>`;
      dialog.querySelector('[role="button"]')!.addEventListener("click", () => {
        const paper = document.createElement("div"); paper.className = "paper";
        paper.innerHTML = '<div class="content">2026. 8. 6. 오후 4:20:05</div>'; dialog.querySelector('[role="button"]')!.append(paper);
      });
      dialog.querySelector("button")!.addEventListener("click", () => { if (!closeBlocked) dialog.remove(); }); document.body.append(dialog);
    });
  }
  document.querySelector("#more")!.addEventListener("click", () => {
    const tbody = document.createElement("tbody"); tbody.innerHTML = row(2002);
    document.querySelector("table")!.append(tbody); document.querySelector("#more")!.remove(); attachDetails();
  });
  const message = (type: string, submissionIds?: string[]) => {
    let result: unknown; listener!({ type, submissionIds }, null, value => { result = value; });
    return result as { status: string; saved: number; skipped: number; completed: number; failedSubmissionIds?: string[]; failureReason?: string };
  };
  async function untilTerminal() {
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => globals.setTimeout(resolve, 5));
      const state = message("LOCAL_HISTORY_STATUS");
      if (!["SCANNING", "IMPORTING", "CANCELLING"].includes(state.status)) return state;
    }
    assert.fail("production task did not settle");
  }
  try {
    const contentModule = "../src/content?continue-rejected-detail";
    await import(contentModule); assert.ok(listener);
    message("LOCAL_HISTORY_SCAN_START"); assert.equal((await untilTerminal()).status, "READY");
    message("LOCAL_HISTORY_IMPORT_START", ["2001", "2002"]);
    const done = await untilTerminal();
    assert.equal(done.status, "DONE"); assert.equal(done.completed, 2); assert.equal(done.saved, 1); assert.equal(done.skipped, 1);
    assert.deepEqual(done.failedSubmissionIds, ["2001"]); assert.deepEqual(stored, ["2002"]);
    assert.deepEqual(opened, ["2001", "2001", "2001", "2002"]); assert.equal(document.querySelector('[role="dialog"]'), null);
    navigate = true; opened.length = 0;
    message("LOCAL_HISTORY_IMPORT_START", ["2001", "2002"]);
    await new Promise(resolve => globals.setTimeout(resolve, 70));
    location.pathname = "/account/9/submission";
    const stopped = message("LOCAL_HISTORY_STATUS");
    assert.equal(stopped.status, "FAILED"); assert.equal(stopped.completed, 0);
    assert.deepEqual(opened, ["2001"]); assert.deepEqual(stored, ["2002"]);
    navigate = false; storeFailure = true; opened.length = 0;
    message("LOCAL_HISTORY_IMPORT_START", ["2002", "2001"]);
    const storageStopped = await untilTerminal();
    assert.equal(storageStopped.status, "FAILED"); assert.equal(storageStopped.failureReason, "STORE_FAILED");
    assert.deepEqual(opened, ["2002"], "storage errors must not replay stores or continue"); assert.deepEqual(stored, ["2002"]);
    storeFailure = false; closeBlocked = true; opened.length = 0;
    message("LOCAL_HISTORY_IMPORT_START", ["2001", "2002"]);
    const cleanupStopped = await untilTerminal();
    assert.equal(cleanupStopped.status, "FAILED"); assert.equal(cleanupStopped.completed, 0);
    assert.ok(opened.every(id => id === "2001"), "an unclosed dialog must prevent the next submission from opening");
    assert.deepEqual(stored, ["2002"]);
  } finally { Object.assign(globalThis, globals); }
});
