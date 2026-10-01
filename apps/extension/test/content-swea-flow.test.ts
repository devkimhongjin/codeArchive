import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

const origin = "https://swexpertacademy.com";
const listUrl = `${origin}/main/userpage/code/userSubmitProblem.do`;
const historyUrl = `${origin}/main/code/problem/problemSubmitHistory.do`;
const detailUrl = `${origin}/main/code/problem/problemSubmitDetail.do`;
const userId = "OwnerABC123";
const nickname = "owner";

function listDocument() {
  return `<div class="my-login"><span class="name hidden-sm-down">${nickname}</span></div><div class="mypage_wrap"><div class="my_label"><span class="nick">${nickname}</span></div></div>
    <form id="searchForm"><input name="userId" value="${userId}"><input name="rowNum" value="20"><input name="pageIndex" value="1"></form><form id="solvingForm"><input name="userId" value="${userId}"></form>
    <h3 class="club_box_tit">제출한 Problem(2)</h3><div class="widget-list solvingclub">${[1, 2].map(number => `<div class="widget-box-sub"><div class="widget-header-sub"><span class="week_num">${number}.</span><span class="week_text"><a onclick="javascript:fn_move_prob('KeyAAAAAAA${number}','N','CODE','','KeyAAAAAAA${number}','');">Problem ${number}</a></span></div></div>`).join("")}</div>`;
}
function historyDocument(problem: number) {
  const id = `Submission0000000${problem}`;
  return `<div class="my-login"><span class="name hidden-sm-down">${nickname}</span></div><form id="problemForm"><input name="contestProbId" value="KeyAAAAAAA${problem}"></form><h5 class="section_tit">총 1회 제출</h5><div class="box-list-inner"><div class="problem_smt"><a href="javascript:codeview('${id}')">code</a><div class="submitter"><div class="smt_txt"><dt><a onclick="userInformationPopup('${userId}')">${nickname}</a></dt><dd>제출일 : 2026-09-28 08:26</dd></div></div><div class="info"><ul><li><span>JAVA</span><span>언어</span></li><li><span>102,076kb</span><span>메모리</span></li><li><span>669ms</span><span>실행시간</span></li><li><span>5B</span><span>코드길이</span></li><li><span>Pass</span><span>결과</span></li></ul></div></div></div>`;
}
function detailDocument(problem: number, title = `Problem ${problem}`, header = nickname) {
  return `<div class="my-login"><span class="name hidden-sm-down">${header}</span></div><form id="problemForm"><input name="contestProbId" value="KeyAAAAAAA${problem}"><input name="contestHistoryId" value=""></form><div class="problem_box"><h1 class="problem_title">${problem}. ${title}<span class="badge">D3</span></h1></div><div class="box-list-inner"><div class="problem_smt_detail"><div class="submitter"><div class="smt_txt"><dt><a onclick="userInformationPopup('${userId}')">${nickname}</a></dt><dd>제출일 : 2026-09-28 08:26</dd></div></div><div class="info"><ul><li><span>JAVA</span><span>언어</span></li><li><span>102,076kb</span><span>메모리</span></li><li><span>669ms</span><span>실행시간</span></li><li><span>5B</span><span>코드길이</span></li><li><span>Pass</span><span>결과</span></li></ul></div></div></div><textarea class="brush:java">hello</textarea>`;
}
function response(body: string, url: string) {
  const value = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  Object.defineProperty(value, "url", { value: url });
  return value;
}
function wait(delay = 30) { return new Promise<void>(resolve => setTimeout(resolve, delay)); }

test("SWEA source owner skips an isolated detail failure, preserves an in-flight store on cancel, and can rescan", async () => {
  const { document } = parseHTML(`<html><body>${listDocument()}</body></html>`);
  const location = new URL(listUrl) as unknown as Location;
  const window = document.defaultView!; Object.defineProperty(window, "location", { value: location, configurable: true });
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  let pendingStore: { promise: Promise<unknown>; resolve: (value: unknown) => void } | undefined; let notifyStoreStarted: (() => void) | undefined; let stores = 0;
  let firstTitleMismatch = true; let detailHeader = nickname;
  const requests: Array<{ url: string; body: string }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const body = String(init?.body ?? ""); requests.push({ url, body });
    if (url.includes("userSubmitProblem")) return response(listDocument(), url);
    const form = new URLSearchParams(body); const problem = Number((form.get("contestProbId") ?? "").slice(-1));
    if (url === historyUrl) return response(historyDocument(problem), url);
    return response(detailDocument(problem, firstTitleMismatch && problem === 1 ? "Wrong title" : `Problem ${problem}`, detailHeader), url);
  };
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } }, sendMessage: async (message: unknown) => {
    if ((message as { type?: string }).type !== "STORE_HISTORICAL_CAPTURE") return { ok: true };
    stores += 1;
    if (pendingStore) { notifyStoreStarted?.(); return pendingStore.promise; }
    return { ok: true, created: true };
  } }, storage: { local: { set: async () => undefined } } };
  const globals = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, fetch: globalThis.fetch, DOMParser: globalThis.DOMParser, MutationObserver: globalThis.MutationObserver, Element: globalThis.Element };
  Object.assign(globalThis, { document, window, chrome, fetch: fetcher, DOMParser: document.defaultView!.DOMParser, MutationObserver: window.MutationObserver, Element: window.Element });
  const message = (payload: unknown) => new Promise<unknown>(resolve => { assert.equal(listener!(payload, null, resolve), false); });
  try {
    const contentModule = "../src/content?swea-flow";
    await import(contentModule); assert.ok(listener);
    assert.equal((await message({ type: "LOCAL_HISTORY_SCAN_START", platform: "SWEA" }) as { status: string }).status, "SCANNING");
    await wait();
    const ready = await message({ type: "LOCAL_HISTORY_STATUS", platform: "SWEA" }) as { status: string; candidates?: Array<{ submissionId: string }> };
    assert.equal(ready.status, "READY"); assert.equal(ready.candidates?.length, 2);
    assert.ok(requests.some(request => request.url === historyUrl && /isChecked=checked/.test(request.body) && /checkUserId=OwnerABC123/.test(request.body)));
    assert.equal((await message({ type: "LOCAL_HISTORY_IMPORT_START", platform: "SWEA", submissionIds: ready.candidates!.map(item => item.submissionId) }) as { status: string }).status, "IMPORTING");
    await wait();
    const afterFailure = await message({ type: "LOCAL_HISTORY_STATUS", platform: "SWEA" }) as { status: string; saved?: number; skipped?: number; problemCount?: number };
    assert.equal(afterFailure.status, "DONE"); assert.equal(afterFailure.saved, 1); assert.equal(afterFailure.skipped, 1); assert.equal(afterFailure.problemCount, 1);
    assert.ok(requests.some(request => request.url === detailUrl && /contestHistoryId=Submission00000002/.test(request.body)));

    assert.equal((await message({ type: "LOCAL_HISTORY_SCAN_START", platform: "SWEA" }) as { status: string }).status, "SCANNING");
    await wait();
    const rescanned = await message({ type: "LOCAL_HISTORY_STATUS", platform: "SWEA" }) as { status: string; candidates?: Array<{ submissionId: string }> };
    assert.equal(rescanned.status, "READY");
    const second = rescanned.candidates!.find(item => item.submissionId.endsWith("2"))!;
    let settleStore!: (value: unknown) => void; const storeStarted = new Promise<void>(resolve => { notifyStoreStarted = resolve; });
    pendingStore = { promise: new Promise(resolve => { settleStore = resolve; }), resolve: value => settleStore(value) };
    await message({ type: "LOCAL_HISTORY_IMPORT_START", platform: "SWEA", submissionIds: [second.submissionId] }); await storeStarted;
    const cancelling = await message({ type: "LOCAL_HISTORY_CANCEL", platform: "SWEA" }) as { status: string };
    assert.equal(cancelling.status, "CANCELLING"); pendingStore.resolve({ ok: true, created: true }); await wait();
    const interrupted = await message({ type: "LOCAL_HISTORY_STATUS", platform: "SWEA" }) as { status: string; saved?: number; completed?: number; problemCount?: number };
    assert.equal(interrupted.status, "INTERRUPTED"); assert.equal(interrupted.saved, 1); assert.equal(interrupted.completed, 1); assert.equal(interrupted.problemCount, 1); assert.equal(stores, 2);

    // The listing document remains unchanged, but a detail response reveals a
    // different signed-in account. That is terminal, so no second detail/store.
    firstTitleMismatch = false; detailHeader = "other-account";
    assert.equal((await message({ type: "LOCAL_HISTORY_SCAN_START", platform: "SWEA" }) as { status: string }).status, "SCANNING");
    await wait();
    const accountShifted = await message({ type: "LOCAL_HISTORY_STATUS", platform: "SWEA" }) as { status: string; candidates?: Array<{ submissionId: string }> };
    assert.equal(accountShifted.status, "READY");
    const detailReadsBefore = requests.filter(request => request.url === detailUrl).length;
    await message({ type: "LOCAL_HISTORY_IMPORT_START", platform: "SWEA", submissionIds: accountShifted.candidates!.map(candidate => candidate.submissionId) });
    await wait();
    const accountInterrupted = await message({ type: "LOCAL_HISTORY_STATUS", platform: "SWEA" }) as { status: string; completed?: number; saved?: number };
    assert.equal(accountInterrupted.status, "INTERRUPTED"); assert.equal(accountInterrupted.completed, 1); assert.equal(accountInterrupted.saved, 0);
    assert.equal(requests.filter(request => request.url === detailUrl).length, detailReadsBefore + 1);
    assert.equal(stores, 2);
  } finally { Object.assign(globalThis, globals); }
});
