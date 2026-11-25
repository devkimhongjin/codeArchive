import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { BAEKJOON_PAGE_DELAY_MS, BAEKJOON_SOURCE_DELAY_MS, BaekjoonHistoryTask, type BaekjoonHistoryDeps } from "../src/baekjoonHistoryTask";
import { BaekjoonTab, SolvedAcDifficulty, baekjoonHistoricalCapture, type BaekjoonTabApi } from "../src/baekjoonBackground";
import { baekjoonListingUrl, type BaekjoonHistoryCandidate } from "../src/historicalBaekjoon";
import { baekjoonSyncPage } from "../src/siteSyncPages";
import { normalizeDifficulty, solvedAcTierLabel } from "../../../shared/difficulty";
import { canonicalLanguageKey } from "../../../shared/language";

const USER = "boj_user";
const candidate = (id: string, problem = "1000"): BaekjoonHistoryCandidate => ({ submissionId: id, problemNumber: problem, title: "A+B", language: "C++17",
  solvedAt: "2026-11-23T07:55:52.000Z", codeLength: 101, executionTime: 1, memoryValue: 1128 });

function harness(pages: Record<string, unknown>, overrides: Partial<BaekjoonHistoryDeps> = {}) {
  const loads: string[] = [], sleeps: number[] = [], stored: string[] = [];
  let closed = 0;
  const deps: BaekjoonHistoryDeps = {
    async load(url) { loads.push(url); return { ok: true, value: 7 }; },
    async ask(_tab, message) {
      const type = (message as { type: string }).type;
      if (type === "BAEKJOON_IDENTITY") return { ok: true, value: { username: USER } };
      if (type === "BAEKJOON_LISTING_READ") return { ok: true, value: pages[(message as { url: string }).url] ?? { status: "UNREADABLE" } };
      return { ok: true, value: { status: "DONE", sourceCode: "int main(){}", title: "A+B" } };
    },
    async close() { closed += 1; },
    async sleep(ms) { sleeps.push(ms); },
    now: () => 1_000,
    random: () => 0.5,
    async store(item) { stored.push(item.submissionId); return { ok: true, created: true }; },
    ...overrides
  };
  return { task: new BaekjoonHistoryTask(deps), loads, sleeps, stored, closed: () => closed };
}
const settle = async (task: BaekjoonHistoryTask) => { for (let index = 0; index < 200 && task.active; index += 1) await new Promise(resolve => setTimeout(resolve, 1)); };

test("a scan reads the signed-in id, then every accepted page with a pause between page loads", async () => {
  const first = baekjoonListingUrl(USER), second = baekjoonListingUrl(USER, "105249199");
  const { task, loads, sleeps, closed } = harness({
    [first]: { status: "READY", username: USER, candidates: [candidate("105249300"), candidate("105249200")], nextUrl: second },
    [second]: { status: "READY", username: USER, candidates: [candidate("105249100", "1001")], nextUrl: null }
  });
  assert.equal((task.scan() as { status: string }).status, "SCANNING");
  assert.deepEqual(task.scan(), { status: "BUSY" }, "one collection at a time");
  await settle(task);
  const state = task.status() as { status: string; candidates: BaekjoonHistoryCandidate[] };
  assert.equal(state.status, "READY");
  assert.deepEqual(state.candidates.map(item => item.submissionId), ["105249300", "105249200", "105249100"]);
  assert.deepEqual(loads, ["https://acmicpc.net/", first, second]);
  assert.deepEqual(sleeps, [BAEKJOON_PAGE_DELAY_MS], "every further listing page waits first");
  assert.equal(task.username, USER);
  assert.equal(closed(), 0, "the tab stays open for the import");
});

test("a scan stops on a signed-out home page or an unreadable page and closes its tab", async () => {
  const signedOut = harness({}, { async ask() { return { ok: true, value: { username: null } }; } });
  signedOut.task.scan(); await settle(signedOut.task);
  assert.deepEqual(signedOut.task.status(), { status: "LOGIN_REQUIRED" });
  assert.equal(signedOut.closed(), 1);
  const broken = harness({});
  broken.task.scan(); await settle(broken.task);
  assert.deepEqual(broken.task.status(), { status: "SCAN_INCOMPLETE", failurePage: 1 });
  const notOwner = harness({ [baekjoonListingUrl(USER)]: { status: "NOT_OWNER" } });
  notOwner.task.scan(); await settle(notOwner.task);
  assert.deepEqual(notOwner.task.status(), { status: "LOGIN_REQUIRED" });
});

test("an import opens each selected source page in turn, spaced 3–5 s apart, and counts what was stored", async () => {
  const first = baekjoonListingUrl(USER);
  const { task, loads, sleeps, stored, closed } = harness({ [first]: { status: "READY", username: USER, candidates: [candidate("3"), candidate("2"), candidate("1")], nextUrl: null } });
  task.scan(); await settle(task);
  assert.deepEqual(task.import(["9"]), { status: "BAD_REQUEST" }, "only ids from the scanned list");
  loads.length = 0; sleeps.length = 0;
  assert.equal((task.import(["3", "1"]) as { status: string }).status, "IMPORTING");
  await settle(task);
  const state = task.status() as { status: string; saved: number; storedSubmissionIds: string[] };
  assert.equal(state.status, "DONE");
  assert.equal(state.saved, 2);
  assert.deepEqual(state.storedSubmissionIds, ["3", "1"]);
  assert.deepEqual(stored, ["3", "1"]);
  assert.deepEqual(loads, ["https://acmicpc.net/source/3", "https://acmicpc.net/source/1"]);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0]! >= BAEKJOON_SOURCE_DELAY_MS && sleeps[0]! <= BAEKJOON_SOURCE_DELAY_MS + 2_000);
  assert.equal(closed(), 1, "the owned tab closes when the import ends");
});

test("an unverified source page is skipped and reported, and cancelling stops the import", async () => {
  const first = baekjoonListingUrl(USER);
  let release: () => void = () => undefined;
  const { task, stored } = harness({ [first]: { status: "READY", username: USER, candidates: [candidate("3"), candidate("2"), candidate("1")], nextUrl: null } }, {
    async ask(_tab, message) {
      const type = (message as { type: string }).type;
      if (type === "BAEKJOON_IDENTITY") return { ok: true, value: { username: USER } };
      if (type === "BAEKJOON_LISTING_READ") return { ok: true, value: { status: "READY", username: USER, candidates: [candidate("3"), candidate("2"), candidate("1")], nextUrl: null } };
      if ((message as { candidate: BaekjoonHistoryCandidate }).candidate.submissionId === "3") return { ok: true, value: { status: "DETAIL_UNVERIFIED" } };
      return { ok: true, value: { status: "DONE", sourceCode: "x" } };
    },
    async sleep() { await new Promise<void>(resolve => { release = resolve; }); }
  });
  task.scan(); await settle(task);
  task.import(["3", "2", "1"]);
  for (let index = 0; index < 50 && !(task.status() as { completed?: number }).completed; index += 1) await new Promise(resolve => setTimeout(resolve, 1));
  const cancelled = task.cancel() as { status: string };
  assert.equal(cancelled.status, "CANCELLING");
  release();
  await settle(task);
  const state = task.status() as { status: string; skipped: number; failedSubmissionIds: string[]; completed: number };
  assert.equal(state.status, "INTERRUPTED");
  assert.equal(state.skipped, 1);
  assert.deepEqual(state.failedSubmissionIds, ["3"]);
  assert.deepEqual(stored, [], "nothing stored after the cancel");
});

function tabApi(states: Array<{ url?: string; status?: string; pendingUrl?: string }>, sendResults: Array<unknown | Error> = [{ ok: 1 }]) {
  const calls: string[] = [];
  const api: BaekjoonTabApi = {
    async create(url) { calls.push(`create ${url}`); return 11; },
    async update(_id, url) { calls.push(`update ${url}`); return true; },
    async get() { return states.length > 1 ? states.shift()! : states[0]!; },
    async remove(id) { calls.push(`remove ${id}`); },
    async send() { const next = sendResults.length > 1 ? sendResults.shift() : sendResults[0]; if (next instanceof Error) throw next; return next; },
    async inject() { calls.push("inject"); },
    async sleep() { /* immediate */ }
  };
  return { api, calls };
}

test("the owned tab waits for the exact page and treats a redirect as a failed load", async () => {
  const ok = tabApi([{ url: "https://acmicpc.net/status?user_id=a", status: "complete" }, { url: "https://acmicpc.net/source/1", status: "loading" }, { url: "https://acmicpc.net/source/1", status: "complete" }]);
  const tab = new BaekjoonTab(ok.api, 5_000);
  assert.deepEqual(await tab.load("https://acmicpc.net/source/1"), { ok: true, value: 11 });
  assert.deepEqual(ok.calls, ["create https://acmicpc.net/source/1"]);
  const redirected = new BaekjoonTab(tabApi([{ url: "https://acmicpc.net/login?next=%2Fsource%2F1", status: "complete" }]).api, 5_000);
  assert.deepEqual(await redirected.load("https://acmicpc.net/source/1"), { ok: false, reason: "LOAD_FAILED" });
  await tab.close();
  assert.equal(tab.id, null);
  assert.deepEqual(ok.calls.at(-1), "remove 11");
});

test("the owned tab injects its reader only after the declared one never answered", async () => {
  const missing = new Error("Could not establish connection. Receiving end does not exist.");
  const late = tabApi([{ url: "https://acmicpc.net/", status: "complete" }], [missing, missing, { username: USER }]);
  const tab = new BaekjoonTab(late.api, 1_000);
  await tab.load("https://acmicpc.net/");
  assert.deepEqual(await tab.ask(11, { type: "BAEKJOON_IDENTITY" }), { ok: true, value: { username: USER } });
  assert.equal(late.calls.includes("inject"), false, "a late content script is waited for, not duplicated");
  const never = tabApi([{ url: "https://acmicpc.net/", status: "complete" }], [missing, missing, missing, missing, missing, missing, missing, missing, missing, missing, { username: USER }]);
  const other = new BaekjoonTab(never.api, 1_000);
  await other.load("https://acmicpc.net/");
  assert.deepEqual(await other.ask(11, { type: "BAEKJOON_IDENTITY" }), { ok: true, value: { username: USER } });
  assert.equal(never.calls.includes("inject"), true);
  assert.deepEqual(await other.ask(12, { type: "BAEKJOON_IDENTITY" }), { ok: false, reason: "NO_RECEIVER" }, "only its own tab");
});

test("solved.ac levels map to tiers, and only this problem's own API entry is accepted as the source", () => {
  assert.deepEqual([0, 1, 5, 6, 15, 16, 30, 31].map(solvedAcTierLabel), [undefined, "Bronze V", "Bronze I", "Silver V", "Gold I", "Platinum V", "Ruby I", undefined]);
  const source = "https://solved.ac/api/v3/problem/show?problemId=1000";
  assert.deepEqual(normalizeDifficulty("BAEKJOON", "1000", "https://acmicpc.net/problem/1000", { label: "Bronze V", problemNumber: "1000", sourceUrl: source }),
    { label: "Bronze V", problemNumber: "1000", sourceUrl: source });
  assert.equal(normalizeDifficulty("BAEKJOON", "1000", "https://www.acmicpc.net/problem/1000", { label: "Bronze V", problemNumber: "1000", sourceUrl: source })?.label, "Bronze V");
  for (const [name, platform, problemUrl, label, sourceUrl] of [
    ["another problem's entry", "BAEKJOON", "https://acmicpc.net/problem/1000", "Bronze V", "https://solved.ac/api/v3/problem/show?problemId=1001"],
    ["not a tier", "BAEKJOON", "https://acmicpc.net/problem/1000", "Gold 3", source],
    ["another site", "BAEKJOON", "https://acmicpc.net/problem/1000", "Bronze V", "https://example.com/api/v3/problem/show?problemId=1000"],
    ["another problem page", "BAEKJOON", "https://acmicpc.net/problem/1001", "Bronze V", source],
    ["Jungol never takes a BOJ tier", "JUNGOL", "https://jungol.co.kr/problem/1000", "Bronze V", source]
  ] as const) assert.equal(normalizeDifficulty(platform, "1000", problemUrl, { label, problemNumber: "1000", sourceUrl }), undefined, name);
});

test("the tier lookup sends no cookies, checks the problem id and never blocks a capture", async () => {
  const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
  let answer: () => Response = () => Response.json({ problemId: 1000, level: 1 });
  const lookup = new SolvedAcDifficulty((async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), credentials: init?.credentials }); return answer();
  }) as typeof fetch);
  assert.equal((await lookup.lookup("1000"))?.label, "Bronze V");
  assert.equal((await lookup.lookup("1000"))?.label, "Bronze V");
  assert.equal(requests.length, 1, "answers are cached");
  assert.deepEqual(requests[0], { url: "https://solved.ac/api/v3/problem/show?problemId=1000", credentials: "omit" });
  answer = () => Response.json({ problemId: 9999, level: 12 });
  assert.equal(await lookup.lookup("1001"), undefined, "an answer for another problem is ignored");
  answer = () => { throw new TypeError("offline"); };
  assert.equal(await lookup.lookup("1002"), undefined);
  const capture = baekjoonHistoricalCapture(candidate("105249231"), "int main(){}")!;
  assert.equal((await lookup.enrich(capture)).difficulty?.label, "Bronze V");
  assert.equal((await new SolvedAcDifficulty((async () => { throw new TypeError("offline"); }) as typeof fetch).enrich(capture)).difficulty, undefined);
});

test("a verified past submission becomes a historical capture with the site's metrics", () => {
  const capture = baekjoonHistoricalCapture(candidate("105249231"), "int main(){}");
  assert.equal(capture?.platform, "BAEKJOON");
  assert.equal(capture?.historicalImport, true);
  assert.equal(capture?.historicalSubmissionId, "105249231");
  assert.equal(capture?.problemUrl, "https://acmicpc.net/problem/1000");
  assert.equal(capture?.solvedAt, "2026-11-23T07:55:52.000Z");
  assert.deepEqual([capture?.executionTime, capture?.memoryValue, capture?.memoryUnit], [1, 1128, "KB"]);
  assert.equal(capture?.languageKey, "cpp");
});

test("Baekjoon language names map to the shared language keys", () => {
  assert.deepEqual(["C++17", "C++20 (Clang)", "C99", "C11 (Clang)", "C (Clang)", "Python 3", "PyPy3", "Java 11", "Java 8 (OpenJDK)", "Kotlin (JVM)", "node.js", "Go (gccgo)", "Rust 2021", "C#", "Text"]
    .map(canonicalLanguageKey), ["cpp", "cpp", "c", "c", "c", "python", "python", "java", "java", "kotlin", "javascript", "go", "rust", "csharp", "unknown:text"]);
});

test("status-page sync buttons go only on the signed-in user's own accepted rows", async () => {
  const header = "<thead><tr><th>제출 번호</th><th>아이디</th><th>문제</th><th>결과</th><th>메모리</th><th>시간</th><th>채점 서버</th><th>언어</th><th>코드 길이</th><th>제출한 시간</th></tr></thead>";
  const line = (id: string, color: string, text: string) => `<tr id="solution-${id}"><td>${id}</td><td><a href="/user/${USER}">${USER}</a></td><td><a href="/problem/1000" class="problem_title" data-original-title="A+B">1000</a></td>` +
    `<td class="result"><span class="result-text result-${color}" data-color="${color}">${text}</span></td><td class="memory">1128</td><td class="time">1</td><td></td>` +
    `<td><a href="/source/${id}">C++17</a></td><td>101</td><td><a data-timestamp="1795420552">1분 전</a></td></tr>`;
  const html = (bar: string) => parseHTML(`<html><body>${bar}<table id="status-table">${header}<tbody>${line("2", "ac", "맞았습니다!!")}${line("1", "wa", "틀렸습니다")}</tbody></table></body></html>`).document;
  const bar = `<ul class="loginbar"><li><a href="/user/${USER}" class="username">${USER}</a></li></ul>`;
  const sent: unknown[] = [];
  const send = async (message: unknown) => { sent.push(message); return (message as { type: string }).type === "BAEKJOON_SITE_SYNC_READ" ? { ok: false, error: "LOGIN_REQUIRED" } : undefined; };
  const none = { read: () => null, write() {}, clear() {}, consumed: () => [], consume() {} };
  const own = baekjoonSyncPage(html(bar), new URL(`https://acmicpc.net/status?user_id=${USER}`) as unknown as Location, send, none);
  const targets = own.targets();
  assert.deepEqual(targets.map(target => target.id), ["2"]);
  assert.deepEqual(targets[0]!.row, { submissionId: "2", problemNumber: "1000", language: "C++17", solvedAt: new Date(1795420552000).toISOString() });
  assert.deepEqual(await targets[0]!.sync(), { ok: false, message: "백준 로그인 상태를 확인하지 못했습니다" });
  assert.equal((sent[0] as { username: string }).username, USER);
  assert.equal(baekjoonSyncPage(html(bar), new URL("https://acmicpc.net/status?user_id=someone") as unknown as Location, send, none).targets().length, 0, "someone else's list");
  const claimed = { value: null as unknown, used: ["2"], read() { return this.value; }, write() {}, clear() {}, consumed() { return this.used; }, consume() {} };
  assert.equal(baekjoonSyncPage(html(bar), new URL(`https://acmicpc.net/status?user_id=${USER}`) as unknown as Location, send, claimed).targets().length, 0,
    "a row this tab captured live gets no sync button");
  claimed.used = [];
  claimed.value = { version: 1, problemNumber: "1000", title: "A+B", language: "C++17", sourceCode: "x", username: USER, startedAt: 1795420552000 - 1_000 };
  assert.equal(baekjoonSyncPage(html(bar), new URL(`https://acmicpc.net/status?user_id=${USER}`) as unknown as Location, send, claimed, () => 1795420552000 + 5_000).targets().length, 0,
    "nor does a row the pending live attempt may still capture");
  assert.equal(baekjoonSyncPage(html(bar), new URL(`https://acmicpc.net/status?user_id=${USER}`) as unknown as Location, send, claimed, () => 1795420552000 + 20 * 60_000).targets().length, 1,
    "an expired attempt claims nothing");
  assert.equal(baekjoonSyncPage(html(""), new URL(`https://acmicpc.net/status?user_id=${USER}`) as unknown as Location, send, none).targets().length, 0, "signed out");
});
