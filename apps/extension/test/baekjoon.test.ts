import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { BaekjoonAdapter, sessionAttemptStore, type BaekjoonAttemptStore } from "../src/adapters/baekjoon";
import { baekjoonAcceptedText, baekjoonUsername, readBaekjoonSourcePage, readBaekjoonStatusRows } from "../src/adapters/baekjoonSelectors";
import { createAdapter } from "../src/adapters";
import { collectAcceptedCaptureAttempt } from "../src/capture";
import { syncEditorAtSubmitClick } from "../src/mainWorld";
import { baekjoonListingUrl, baekjoonListingUser, readBaekjoonListingPage, readBaekjoonSourceForCandidate, type BaekjoonHistoryCandidate } from "../src/historicalBaekjoon";
import { historyPlatformForUrl } from "../src/historyRouting";
import { isHistoricalSubmissionId } from "../src/historicalIdentity";

const location = (href: string) => new URL(href) as unknown as Location;
const USER = "boj_user";
const LOGINBAR = `<ul class="loginbar pull-right"><li><a href="/user/${USER}" class="username">${USER}</a></li><li class="topbar-devider"></li><li><a href="/modify">설정</a></li></ul>`;
const HEADER = "<thead><tr><th>제출 번호</th><th>아이디</th><th>문제</th><th>결과</th><th>메모리</th><th>시간</th><th>채점 서버</th><th>언어</th><th>코드 길이</th><th>제출한 시간</th></tr></thead>";
const SOURCE = "import java.util.*;\npublic class Main { public static void main(String[] a) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt() + s.nextInt()); } }\n";

type Row = { id: string; user?: string; problem?: string; title?: string; color?: string; text?: string; memory?: string; time?: string; language?: string; length?: number; seconds: number; own?: boolean };
function row(item: Row): string {
  const user = item.user ?? USER, problem = item.problem ?? "1000";
  const language = item.own === false ? (item.language ?? "Java 11") : `<a href="/source/${item.id}">${item.language ?? "Java 11"}</a>&nbsp;/&nbsp;<a href="/submit/${problem}/${item.id}">수정</a>`;
  const color = item.color ?? "wait";
  return `<tr id="solution-${item.id}" data-can-view="${item.own === false ? "" : "1"}"><td>${item.id}</td><td><a href="/user/${user}">${user}</a></td>` +
    `<td><a href="/problem/${problem}" rel="tooltip" title="" class="problem_title tooltip-click " data-original-title="${item.title ?? "A+B"}">${problem}</a></td>` +
    `<td class="result"><span class="result-text result-${color} " data-color="${color}">${item.text ?? "기다리는 중"}</span></td>` +
    `<td class="memory">${item.memory ?? ""}${item.memory ? '<span class="kb-text"></span>' : ""}</td><td class="time">${item.time ?? ""}${item.time ? '<span class="ms-text"></span>' : ""}</td>` +
    `<td class="judge-platform"></td><td>${language}</td><td>${item.length ?? new TextEncoder().encode(SOURCE).length}<span class="b-text"></span></td>` +
    `<td><a href="javascript:void(0);" rel="tooltip" title="" data-timestamp="${item.seconds}" class="real-time-update show-date " data-method="from-now">방금 전</a></td></tr>`;
}
const statusPage = (rows: string, bar = LOGINBAR, next = "") =>
  parseHTML(`<html><body>${bar}<table class="table" id="status-table">${HEADER}<tbody>${rows}</tbody></table>${next}</body></html>`).document;

function memoryStore(): BaekjoonAttemptStore & { value: unknown; used: string[] } {
  const store = { value: null as unknown, used: [] as string[],
    read: () => store.value, write: (attempt: unknown) => { store.value = attempt; }, clear: () => { store.value = null; },
    consumed: () => store.used, consume: (id: string) => { store.used = [id, ...store.used]; } };
  return store;
}

function submitPage(sourceValue = "") {
  const { document } = parseHTML(`<html><body>${LOGINBAR}<form action="" method="post" class="form-horizontal submit-form" id="submit_form"><legend>A+B</legend>` +
    `<input type="hidden" value="1000" name="problem_id"><select id="language" name="language"><option value="84">C++17</option><option value="93" selected>Java 11</option></select>` +
    `<textarea id="source" class="codemirror-textarea" name="source"></textarea><div class="CodeMirror cm-s-default"></div>` +
    `<button id="submit_button" type="submit" class="btn btn-primary">제출</button></form></body></html>`);
  (document.querySelector("#source") as HTMLTextAreaElement).value = sourceValue;
  return document;
}

test("status rows read the site's own cells: owner, problem, result colour, metrics, language, length and server time", () => {
  const document = statusPage(row({ id: "105248821", color: "ac", text: "맞았습니다!!", memory: "1128", time: "1", language: "C++17", length: 101, seconds: 1795419024 }) +
    row({ id: "105248963", user: "dvtvdvn", color: "rte", text: '<a href="/help/rte">런타임 에러&nbsp;(NameError)</a>', language: "Python 3", own: false, length: 10, seconds: 1795419589 }));
  const [accepted, other] = readBaekjoonStatusRows(document);
  assert.deepEqual({ ...accepted, row: undefined }, { row: undefined, submissionId: "105248821", username: USER, problemNumber: "1000", title: "A+B",
    resultColor: "ac", accepted: true, rejected: false, language: "C++17", codeLength: 101, timeMs: 1, memoryKb: 1128,
    submittedAt: new Date(1795419024 * 1000).toISOString(), ownSource: true });
  assert.equal(other?.ownSource, false, "another user's row links no source");
  assert.equal(other?.rejected, true);
  assert.equal(other?.language, "Python 3");
  assert.equal(baekjoonUsername(document), USER);
  assert.equal(baekjoonUsername(parseHTML('<ul class="loginbar"><li><a href="/login?next=%2F">로그인</a></li></ul>').document), null);
});

test("only a full accept counts; partial scores and unfinished judging never do", () => {
  for (const text of ["맞았습니다!!", "Accepted", "100점", "맞았습니다!! (3/3)"]) assert.equal(baekjoonAcceptedText(text), true, text);
  for (const text of ["37점", "맞았습니다!! (2/3)", "채점 중 (45%)", "틀렸습니다", ""]) assert.equal(baekjoonAcceptedText(text), false, text);
});

test("the MAIN-world hook copies the CodeMirror editor into the submit form at the click", () => {
  const document = submitPage("stale");
  const wrapper = document.querySelector(".CodeMirror") as HTMLElement & { CodeMirror?: unknown };
  let saved = false;
  wrapper.CodeMirror = { getValue: () => SOURCE, save: () => { saved = true; } };
  assert.equal(syncEditorAtSubmitClick(document, location("https://acmicpc.net/submit/1000"), {} as never), true);
  assert.equal((document.querySelector("#source") as HTMLTextAreaElement).value, SOURCE);
  assert.equal(saved, true);
  assert.match(document.documentElement.getAttribute("data-codearchive-editor-sync") ?? "", /^synced:\d+$/);
  // A wrapper without an editor instance is never treated as the source.
  delete wrapper.CodeMirror;
  assert.equal(syncEditorAtSubmitClick(document, location("https://acmicpc.net/submit/1000"), {} as never), false);
});

test("a submit click records the attempt, and the status page captures only its own accepted row", async () => {
  let now = Date.UTC(2026, 10, 23, 7, 56, 13);
  const store = memoryStore();
  const submit = submitPage(SOURCE);
  submit.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  const submitter = new BaekjoonAdapter(submit, location("https://acmicpc.net/submit/1000"), store, () => now);
  assert.equal(submitter.isSubmitControl(submit.querySelector("#submit_button")!), true);
  assert.deepEqual(submitter.detectProblem(), { problemNumber: "1000", title: "A+B", problemUrl: "https://acmicpc.net/problem/1000" });
  submitter.beginSubmissionAttempt(new Date(now));
  assert.equal(submitter.hasPendingSubmissionAttempt(), false, "the submit page leaves for the status page; it never waits");
  assert.equal((store.value as { language?: string }).language, "Java 11");

  now += 1_500;
  const seconds = Math.floor((now - 500) / 1000);
  const status = statusPage(row({ id: "105249300", seconds }) + row({ id: "105249231", color: "ce", text: "컴파일 에러", seconds: seconds - 60 }));
  const statusLocation = location(`https://acmicpc.net/status?problem_id=&user_id=${USER}&language_id=-1&result_id=-1&from_mine=1`);
  const adapter = createAdapter(status, statusLocation);
  assert.ok(adapter instanceof BaekjoonAdapter);
  const watcher = new BaekjoonAdapter(status, statusLocation, store, () => now);
  assert.equal(watcher.hasPendingSubmissionAttempt(), true);
  assert.equal(watcher.detectSubmissionResult(), null, "still judging");

  // Pusher updates the row in place.
  const span = status.querySelector("#solution-105249300 span.result-text")!;
  span.className = "result-text result-ac "; span.setAttribute("data-color", "ac"); span.textContent = "맞았습니다!!";
  status.querySelector("#solution-105249300 td.memory")!.innerHTML = "14196<span class='kb-text'></span>";
  status.querySelector("#solution-105249300 td.time")!.innerHTML = "132<span class='ms-text'></span>";
  const collected = collectAcceptedCaptureAttempt(watcher, new Date(now));
  assert.ok(collected);
  assert.equal(collected.capture.platform, "BAEKJOON");
  assert.equal(collected.capture.sourceCode, SOURCE);
  assert.deepEqual([collected.capture.executionTime, collected.capture.memoryValue, collected.capture.memoryUnit], [132, 14196, "KB"]);
  const confirmed = await watcher.confirmCaptureAsync(collected.capture, collected.detection);
  assert.equal(confirmed?.solvedAt, new Date(seconds * 1000).toISOString(), "the judge's own submission time");
  assert.equal(confirmed?.historicalSubmissionId, undefined, "a live capture carries no site submission id");
  watcher.consumeSubmissionResult(collected.detection);
  assert.equal(store.value, null);
  assert.deepEqual(store.used, ["105249300"]);
  assert.equal(watcher.hasPendingSubmissionAttempt(), false);
});

test("a status row that does not match the attempt is never captured, and a rejected one ends it", () => {
  const now = Date.UTC(2026, 10, 23, 8, 0, 0), seconds = Math.floor(now / 1000);
  const attempt = { version: 1, problemNumber: "1000", title: "A+B", language: "Java 11", sourceCode: SOURCE, username: USER, startedAt: now - 1_000 };
  const statusLocation = location(`https://acmicpc.net/status?user_id=${USER}&from_mine=1`);
  const accepted = { color: "ac", text: "맞았습니다!!", memory: "1", time: "1", seconds };
  for (const [name, html] of [
    ["other code length", row({ id: "1", ...accepted, length: 3 })],
    ["other language", row({ id: "2", ...accepted, language: "C++17" })],
    ["other problem", row({ id: "3", ...accepted, problem: "1001" })],
    ["older than the click", row({ id: "4", ...accepted, seconds: seconds - 10 * 60 })],
    ["another user", row({ id: "5", ...accepted, user: "someone", own: false })]
  ] as const) {
    const store = memoryStore(); store.value = attempt;
    assert.equal(new BaekjoonAdapter(statusPage(html), statusLocation, store, () => now).detectSubmissionResult(), null, name);
  }
  const consumed = memoryStore(); consumed.value = attempt; consumed.used = ["6"];
  assert.equal(new BaekjoonAdapter(statusPage(row({ id: "6", ...accepted })), statusLocation, consumed, () => now).detectSubmissionResult(), null, "already captured");

  const signedOut = memoryStore(); signedOut.value = attempt;
  assert.equal(new BaekjoonAdapter(statusPage(row({ id: "7", ...accepted }), '<ul class="loginbar"><li><a href="/login">로그인</a></li></ul>'), statusLocation, signedOut, () => now)
    .hasPendingSubmissionAttempt(), false, "the attempt belongs to the signed-in user only");

  const rejected = memoryStore(); rejected.value = attempt;
  const adapter = new BaekjoonAdapter(statusPage(row({ id: "8", color: "wa", text: "틀렸습니다", seconds })), statusLocation, rejected, () => now);
  assert.equal(adapter.detectSubmissionResult(), null);
  assert.equal(rejected.value, null, "a wrong answer clears the attempt so nothing waits for it");

  const expired = memoryStore(); expired.value = { ...attempt, startedAt: now - 16 * 60_000 };
  assert.equal(new BaekjoonAdapter(statusPage(row({ id: "9", ...accepted })), statusLocation, expired, () => now).hasPendingSubmissionAttempt(), false);
  assert.equal(expired.value, null);
});

test("an unsynced editor at the click records nothing", () => {
  const now = Date.now(), store = memoryStore();
  const submit = submitPage(SOURCE);
  submit.documentElement.setAttribute("data-codearchive-editor-sync", `failed:${now}`);
  new BaekjoonAdapter(submit, location("https://acmicpc.net/submit/1000"), store, () => now).beginSubmissionAttempt(new Date(now));
  assert.equal(store.value, null);
});

test("the tab's sessionStorage carries the attempt and never throws", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } } as Storage;
  const store = sessionAttemptStore(() => storage);
  store.write({ version: 1, problemNumber: "1000", title: "A+B", language: "C++17", sourceCode: "x", username: USER, startedAt: 1 });
  assert.equal((store.read() as { problemNumber?: string }).problemNumber, "1000");
  for (let index = 0; index < 60; index += 1) store.consume(String(index));
  assert.equal(store.consumed().length, 50);
  assert.equal(store.consumed()[0], "59");
  store.clear();
  assert.equal(store.read(), null);
  const broken = sessionAttemptStore(() => { throw new Error("blocked"); });
  assert.equal(broken.read(), null);
  assert.doesNotThrow(() => broken.write({ version: 1, problemNumber: "1", title: "t", language: "C", sourceCode: "x", username: USER, startedAt: 1 }));
});

const candidate = (seconds: number): BaekjoonHistoryCandidate => ({ submissionId: "105249300", problemNumber: "1000", title: "A+B", language: "Java 11",
  solvedAt: new Date(seconds * 1000).toISOString(), codeLength: new TextEncoder().encode(SOURCE).length, executionTime: 132, memoryValue: 14196 });

test("the own accepted list is read page by page and continues strictly below what it read", () => {
  const seconds = 1795420573;
  const url = baekjoonListingUrl(USER);
  assert.equal(url, `https://acmicpc.net/status?user_id=${USER}&result_id=4`);
  assert.equal(historyPlatformForUrl(url), "BAEKJOON");
  assert.equal(baekjoonListingUser(`https://acmicpc.net/status?user_id=${USER}&result_id=6`), null, "only the accepted filter");
  assert.equal(baekjoonListingUser(`https://acmicpc.net/status?user_id=${USER}&result_id=4&problem_id=1000`), null);
  const accepted = { color: "ac", text: "맞았습니다!!", memory: "14196", time: "132" };
  const page = readBaekjoonListingPage(statusPage(row({ id: "105249300", ...accepted, seconds }) + row({ id: "105249200", ...accepted, seconds: seconds - 100 }),
    LOGINBAR, `<a href="/status?user_id=${USER}&amp;result_id=4&amp;top=105249199" id="next_page">다음 페이지</a>`), location(url));
  assert.equal(page.status, "READY");
  assert.equal(page.status === "READY" && page.candidates.length, 2);
  assert.deepEqual(page.status === "READY" && page.candidates[0], candidate(seconds));
  assert.equal(page.status === "READY" && page.nextUrl, baekjoonListingUrl(USER, "105249199"));

  const loop = readBaekjoonListingPage(statusPage(row({ id: "105249300", ...accepted, seconds }), LOGINBAR,
    `<a href="/status?user_id=${USER}&amp;result_id=4&amp;top=105249300" id="next_page">다음 페이지</a>`), location(url));
  assert.equal(loop.status, "UNREADABLE", "a next page that does not move down is refused");
  assert.equal(readBaekjoonListingPage(statusPage(""), location(baekjoonListingUrl("someone"))).status, "NOT_OWNER");
  assert.equal(readBaekjoonListingPage(statusPage("", '<ul class="loginbar"><li><a href="/login">로그인</a></li></ul>'), location(url)).status, "LOGIN_REQUIRED");
  assert.equal(readBaekjoonListingPage(statusPage('<tr id="solution-x"><td>?</td></tr>'), location(url)).status, "UNREADABLE");
  assert.equal(isHistoricalSubmissionId("BAEKJOON", "105249300"), true);
  assert.equal(isHistoricalSubmissionId("BAEKJOON", "pg:x"), false);
});

function sourcePage(id: string, options: { user?: string; result?: string; language?: string; length?: number; seconds: number; code?: string }) {
  const { document } = parseHTML(`<html><body>${LOGINBAR}<div class="row"><div class="col-md-12"><textarea class="no-mathjax codemirror-textarea" data-mime="text/x-java" name="source" readonly></textarea>` +
    `<div class="CodeMirror cm-s-default"></div></div><table class="table table-striped"><thead><tr><th>제출 번호</th><th>아이디</th><th>문제</th><th>문제 제목</th><th>결과</th><th>메모리</th><th>시간</th><th>언어</th><th>코드 길이</th><th>제출한 시간</th></tr></thead>` +
    `<tbody><tr><td>${id}</td><td><a href="/user/${options.user ?? USER}">${options.user ?? USER}</a></td><td><a href="/problem/1000">1000</a></td><td>A+B</td>` +
    `<td>${options.result ?? '<span class="result-ac ">맞았습니다!!</span>'}</td><td>14196</td><td>132</td><td>${options.language ?? "Java 11"}</td>` +
    `<td>${options.length ?? new TextEncoder().encode(SOURCE).length}<span class="b-text"></span></td><td><a href="javascript:void(0);" data-timestamp="${options.seconds}" class="real-time-update show-date ">1분 전</a></td></tr></tbody></table></div></body></html>`);
  (document.querySelector("textarea") as HTMLTextAreaElement).value = options.code ?? SOURCE;
  return document;
}

test("a source page is accepted only when it is the selected own accepted submission with the same code length", () => {
  const seconds = 1795420573, at = location("https://acmicpc.net/source/105249300");
  assert.deepEqual(readBaekjoonSourcePage(sourcePage("105249300", { seconds }), at)?.memoryKb, 14196);
  assert.deepEqual(readBaekjoonSourceForCandidate(sourcePage("105249300", { seconds }), at, { username: USER, candidate: candidate(seconds) }),
    { status: "DONE", sourceCode: SOURCE, title: "A+B" });
  for (const [name, page] of [
    ["compile error", sourcePage("105249300", { seconds, result: '<a href="/ceinfo/105249300"><span class="result-ce ">컴파일 에러</span></a>' })],
    ["other language", sourcePage("105249300", { seconds, language: "Java 8" })],
    ["other time", sourcePage("105249300", { seconds: seconds + 1 })],
    ["other code", sourcePage("105249300", { seconds, code: "class Main {}" })],
    ["other submission", sourcePage("105249301", { seconds })]
  ] as const) {
    assert.equal(readBaekjoonSourceForCandidate(page, at, { username: USER, candidate: candidate(seconds) }).status, "DETAIL_UNVERIFIED", name);
  }
  const visitor = parseHTML('<ul class="loginbar"><li><a href="/login">로그인</a></li></ul>').document;
  assert.equal(readBaekjoonSourceForCandidate(visitor, at, { username: USER, candidate: candidate(seconds) }).status, "LOGIN_REQUIRED");
});
