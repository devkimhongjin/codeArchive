import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { mountHistory } from "../src/history";

const candidate = { submissionId: "101", problemNumber: "1000", title: "테스트", executionTime: 1, memoryValue: 2 };
const ready = { status: "READY", candidates: [candidate], truncated: false };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
test("completed local collection reports rejected submissions without hiding successful saves", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } :
    { status: "DONE", completed: 2, total: 2, saved: 1, duplicate: 0, skipped: 1, problemCount: 1, submissionCount: 1, failedSubmissionIds: ["13441823"] });
  await tick(); await tick();
  assert.match(view.document.querySelector("#status")!.textContent!, /문제 1건 · 제출 1건/);
  assert.match(view.document.querySelector("#status")!.textContent!, /확인 실패 1건 \(제출 #13441823\)/);
  assert.equal(view.document.querySelector("#progress")!.textContent, "2/2건 처리했습니다. (100%)");
});
function emit(element: Element, type: string) {
  const EventConstructor = element.ownerDocument.defaultView!.Event;
  element.dispatchEvent(new EventConstructor(type));
}
function choose(select: HTMLSelectElement, value: string) {
  Object.defineProperty(select, "value", { value, configurable: true });
  emit(select, "change");
}

function page(send: (message: { type: string; submissionIds?: string[] }) => Promise<unknown>,
  options: { now?: () => number; readTiming?: () => Promise<unknown> } = {}) {
  const { document } = parseHTML(`<!doctype html><body>
    <button id="scan"></button><button id="cancel" hidden></button><button id="import"></button>
    <select id="platform"><option value="JUNGOL" selected>JUNGOL</option><option value="SWEA">SWEA</option><option value="PROGRAMMERS">PROGRAMMERS</option></select>
    <a id="history-page-link"></a><p id="platform-description"></p><p id="platform-help"></p>
    <select id="selection"><option value="all" selected>all</option><option value="latest">latest</option></select>
    <span id="status"></span><progress id="task-progress"></progress><p id="task-stage"></p><p id="progress"></p><p id="task-time"></p>
    <section id="candidates" hidden><p id="candidate-help"></p><div id="candidate-list"></div></section>
  </body>`);
  const scheduled: (() => void)[] = [];
  mountHistory(document, { send: message => send(message as { type: string; submissionIds?: string[] }),
    schedule: work => { scheduled.push(work); return scheduled.length; }, ...options });
  return { document, scheduled };
}

test("history view opens from local status without a CodeArchive login and disables stale controls while active", async () => {
  const calls: string[] = [];
  const view = page(async message => {
    calls.push(message.type);
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: [] };
    return { status: "SCANNING", progress: { phase: "pages", rows: 1, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0 } };
  });
  await tick(); await tick();
  assert.deepEqual(calls, ["LOCAL_HISTORY_IDS", "LOCAL_HISTORY_STATUS"]);
  assert.equal((view.document.querySelector("#scan") as HTMLButtonElement).disabled, true);
  assert.equal((view.document.querySelector("#selection") as HTMLSelectElement).disabled, true);
  assert.equal((view.document.querySelector("#platform") as HTMLSelectElement).disabled, true);
  assert.equal((view.document.querySelector("#import") as HTMLButtonElement).disabled, true);
  assert.equal((view.document.querySelector("#task-progress") as HTMLProgressElement).hidden, false);
});

test("history page separates settings, site navigation, and local collection", () => {
  const html = readFileSync(new URL("../src/history.html", import.meta.url), "utf8");
  for (const platform of ["JUNGOL", "SWEA", "PROGRAMMERS"]) assert.match(html, new RegExp(`<option value="${platform}"`));
  for (const mode of ["all", "latest", "fastest", "lowest-memory"]) assert.match(html, new RegExp(`<option value="${mode}"`));
  assert.match(html, /<section class="settings-card"[\s\S]*?<section class="site-navigation"[\s\S]*?<section class="collection-card"/);
  assert.match(html, /우측 상단 프로필 → 내 정보 → 제출현황/);
  assert.match(html, /id="source-note"/);
  assert.match(html, /id="task-time"/);
  assert.match(html, /id="task-stage"/);
  assert.doesNotMatch(html, /id="timing-estimate"|로컬 저장 예상:/);
  assert.match(html, /id="history-page-link" href="https:\/\/jungol\.co\.kr\/"/);
  assert.doesNotMatch(html, /내 제출 필터/);
  assert.match(html, /id="history-page-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
});

test("Jungol runtime navigation uses the homepage and agreed profile guidance", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : ready);
  await tick(); await tick();
  const link = view.document.querySelector<HTMLAnchorElement>("#history-page-link")!;
  assert.equal(link.href, "https://jungol.co.kr/");
  assert.equal(link.textContent, "정올 열기 ↗");
  assert.equal(view.document.querySelector("#platform-help")!.textContent, "우측 상단 프로필 → 내 정보 → 제출현황에서 내 제출 내역을 열어 주세요.");
});

test("SWEA uses its own platform-tagged local collection commands", async () => {
  const calls: string[] = [];
  const view = page(async message => { calls.push(message.type); return message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : ready; });
  await tick(); await tick(); calls.length = 0;
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "SWEA"); await tick();
  assert.ok(calls.includes("LOCAL_HISTORY_IDS"));
  assert.ok(calls.includes("LOCAL_HISTORY_STATUS"));
  assert.equal((view.document.querySelector("#scan") as HTMLButtonElement).disabled, false);
  assert.equal((view.document.querySelector("#selection") as HTMLSelectElement).disabled, false);
  assert.equal((view.document.querySelector("#history-page-link") as HTMLAnchorElement).href, "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do");
  assert.match(view.document.querySelector("#status")!.textContent!, /후보 목록/);
});

test("SWEA and Programmers use their own guidance, candidate metadata, and history progress", async () => {
  const sweaCandidate = { submissionId: "Swea0001", problemNumber: "4796", title: "산", language: "JAVA", executionTime: 669, memoryValue: 102076 };
  const programmersCandidate = { submissionId: "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java", problemNumber: "389481", title: "가장 큰 수", language: "java", createdAt: "2026-09-21T16:43:28.310+09:00" };
  const programmersCandidate2 = { ...programmersCandidate, submissionId: "pg:947840:389481:2026-09-21T16:43:27.310+09:00:java", createdAt: "2026-09-21T16:43:27.310+09:00" };
  const view = page(async message => {
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: ["unrelated", programmersCandidate.submissionId] };
    const current = (message as { platform?: string }).platform;
    if (current === "SWEA") return { status: "SCANNING", progress: { phase: "histories", stage: "reading-histories", rows: 93, pagesLoaded: 8, groupsExpanded: 0, groupsTotal: 0, historiesRead: 8, historiesTotal: 93 } };
    if (current === "PROGRAMMERS") return { status: "READY", candidates: [programmersCandidate, programmersCandidate2], truncated: false };
    return { status: "READY", candidates: [sweaCandidate], truncated: false };
  });
  await tick(); await tick();
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "SWEA"); await tick(); await tick();
  assert.match(view.document.querySelector("#progress")!.textContent!, /문제 93건 · 제출 이력 8\/93개 확인/);
  assert.match(view.document.querySelector("#platform-help")!.textContent!, /My Page Code/);
  choose(platform, "PROGRAMMERS"); await tick(); await tick();
  const meta = view.document.querySelector("#candidate-list .meta")!.textContent!;
  assert.match(meta, /2026-09-21T16:43:27\.310\+09:00 · java/);
  assert.doesNotMatch(meta, /pg:947840/);
  assert.match(view.document.querySelector("#candidate-help")!.textContent!, /후보 문제 1건 · 제출 1건.*제외했습니다/);
});

test("non-Jungol failure guidance does not direct users to Jungol", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : { status: "FAILED", failureReason: "DETAIL_NOT_FOUND", completed: 0, total: 1 });
  await tick(); await tick();
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "SWEA"); await tick(); await tick();
  assert.match(view.document.querySelector("#status")!.textContent!, /My Page Code/);
  assert.doesNotMatch(view.document.querySelector("#status")!.textContent!, /정올/);
  choose(platform, "PROGRAMMERS"); await tick(); await tick();
  assert.match(view.document.querySelector("#status")!.textContent!, /해결한 문제 목록/);
  assert.doesNotMatch(view.document.querySelector("#status")!.textContent!, /정올/);
});

test("Programmers first auxiliary wait shows the current problem and 0 of the known total", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : {
    status: "SCANNING", startedAt: 1_000,
    progress: { phase: "histories", stage: "reading-histories", rows: 49, pagesLoaded: 3,
      groupsExpanded: 0, groupsTotal: 0, historiesRead: 0, historiesTotal: 49, currentProblemNumber: "389481" }
  });
  await tick(); await tick();
  assert.equal(view.document.querySelector("#progress")!.textContent, "문제 49건 · 제출 이력 0/49개 확인");
  assert.equal(view.document.querySelector("#task-stage")!.textContent, "문제 #389481의 제출 이력을 확인하는 중입니다.");
  const bar = view.document.querySelector<HTMLProgressElement>("#task-progress")!;
  assert.equal(bar.max, 49); assert.equal(bar.value, 0);
  assert.equal(view.document.querySelector("#task-time")!.textContent, "");
});

test("scan errors retain their problem/page context and unsupported SQL is not presented as collected", async () => {
  const failed = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : {
    status: "SCAN_INCOMPLETE", failureReason: "HISTORY_RESPONSE_UNAVAILABLE", failedProblemNumber: "4014", failurePage: 1,
    progress: { phase: "histories", stage: "reading-histories", rows: 95, pagesLoaded: 5, groupsExpanded: 0, groupsTotal: 0, historiesRead: 0, historiesTotal: 95 }
  });
  await tick(); await tick();
  assert.match(failed.document.querySelector("#status")!.textContent!, /문제 #4014의 제출 이력 1페이지/);
  assert.equal(failed.document.querySelector("#task-stage")!.textContent, "목록 확인이 중단되었습니다.");
  assert.match(failed.document.querySelector("#progress")!.textContent!, /0\/95/);
  const readySql = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : { status: "READY", candidates: [], unsupportedProblemNumbers: ["299310"] });
  await tick(); await tick();
  assert.match(readySql.document.querySelector("#status")!.textContent!, /제출 이력을 제공하지 않는 SQL 문제 1건은 수집 대상에서 제외/);
});

test("late platform results are ignored after a switch and switching back reloads safely", async () => {
  let resolveIds!: (value: unknown) => void; let idCalls = 0; const calls: string[] = [];
  const jungolReady = { status: "READY", candidates: [{ ...candidate, submissionId: "jungol-101" }], truncated: false };
  const programmersReady = { status: "READY", candidates: [{ ...candidate, submissionId: "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java", createdAt: "2026-09-21T16:43:28.310+09:00", language: "java" }], truncated: false };
  const view = page(message => {
    calls.push(message.type);
    if (message.type === "LOCAL_HISTORY_IDS") { idCalls += 1; return idCalls === 1 ? new Promise(resolve => { resolveIds = resolve; }) : Promise.resolve({ submissionIds: [] }); }
    return Promise.resolve((message as { platform?: string }).platform === "PROGRAMMERS" ? programmersReady : jungolReady);
  });
  await tick();
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "PROGRAMMERS"); resolveIds!({ submissionIds: ["101"] }); await tick(); await tick();
  assert.deepEqual([...view.document.querySelectorAll<HTMLInputElement>("#candidate-list input")].map(input => input.getAttribute("aria-label")), ["제출 #pg:947840:389481:2026-09-21T16:43:28.310+09:00:java"]);
  assert.match(view.document.querySelector("#status")!.textContent!, /후보 목록/);
  choose(platform, "JUNGOL"); await tick(); await tick();
  assert.ok(calls.filter(type => type === "LOCAL_HISTORY_IDS").length >= 2);
  assert.deepEqual([...view.document.querySelectorAll<HTMLInputElement>("#candidate-list input")].map(input => input.getAttribute("aria-label")), ["제출 #jungol-101"]);
});

test("an ABA platform switch cannot let an old scan click start Jungol collection", async () => {
  let resolveOld!: (value: unknown) => void; let ids = 0; const calls: string[] = [];
  const view = page(message => {
    calls.push(message.type);
    if (message.type === "LOCAL_HISTORY_IDS") { ids += 1; return ids === 2 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ submissionIds: [] }); }
    if (message.type === "LOCAL_HISTORY_STATUS") return Promise.resolve(ready);
    if (message.type === "LOCAL_HISTORY_SCAN_START") return Promise.resolve({ status: "SCANNING" });
    throw new Error("unexpected message");
  });
  await tick(); await tick();
  emit(view.document.querySelector("#scan")!, "click"); await tick();
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "SWEA"); choose(platform, "JUNGOL");
  resolveOld({ submissionIds: [] }); await tick(); await tick(); await tick();
  assert.equal(calls.filter(type => type === "LOCAL_HISTORY_SCAN_START").length, 0);
  assert.ok(view.document.querySelector("#candidate-list input"));
});

test("a stale poll cannot suppress polling for a new Jungol job after cancel and platform changes", async () => {
  let statusCalls = 0; const calls: string[] = [];
  const scanning = { status: "SCANNING", progress: { phase: "pages", rows: 1, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0 } };
  const view = page(async message => {
    calls.push(message.type);
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: [] };
    if (message.type === "LOCAL_HISTORY_CANCEL") return { status: "DONE", completed: 0, total: 1, saved: 0, duplicate: 0, skipped: 0 };
    if (message.type === "LOCAL_HISTORY_STATUS") return statusCalls++ < 2 ? scanning : ready;
    throw new Error("unexpected message");
  });
  await tick(); await tick();
  assert.equal(view.scheduled.length, 1);
  emit(view.document.querySelector("#cancel")!, "click"); await tick(); await tick();
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "SWEA"); choose(platform, "JUNGOL"); await tick(); await tick();
  assert.equal(view.scheduled.length, 2);
  view.scheduled.shift()!(); await tick(); await tick();
  // The stale timer did not ask for status or clear the current epoch's timer.
  assert.equal(calls.filter(type => type === "LOCAL_HISTORY_STATUS").length, 2);
  view.scheduled.shift()!(); await tick(); await tick();
  assert.equal(calls.filter(type => type === "LOCAL_HISTORY_STATUS").length, 3);
  assert.ok(view.document.querySelector("#candidate-list input"));
});

test("history view retains an intentionally empty selection", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : ready);
  await tick(); await tick();
  const checkbox = view.document.querySelector<HTMLInputElement>("#candidate-list input")!;
  checkbox.checked = false; emit(checkbox, "change");
  assert.equal((view.document.querySelector("#import") as HTMLButtonElement).disabled, true);
  // Rendering again must keep the user's empty choice instead of restoring all.
  emit(view.document.querySelector("#selection")!, "change");
  checkbox.checked = false; emit(checkbox, "change");
  assert.equal((view.document.querySelector("#import") as HTMLButtonElement).disabled, true);
});

test("history view visibly rejects an over-limit all selection", async () => {
  const many = Array.from({ length: 5_001 }, (_, index) => ({ ...candidate, submissionId: String(index + 1) }));
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : { status: "READY", candidates: many, truncated: false });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((view.document.querySelector("#import") as HTMLButtonElement).disabled, true);
  assert.match(view.document.querySelector("#candidate-help")!.textContent!, /최대 5,000개/);
});

test("history view refreshes local IDs after completion and removes saved candidates", async () => {
  let statusCalls = 0; let idsCalls = 0;
  const view = page(async message => {
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: idsCalls++ === 0 ? [] : ["101"] };
    if (message.type === "LOCAL_HISTORY_IMPORT_START") return { status: "IMPORTING", completed: 0, total: 1, saved: 0, duplicate: 0, skipped: 0 };
    if (message.type === "LOCAL_HISTORY_STATUS") return statusCalls++ === 0 ? ready : { status: "DONE", completed: 1, total: 1, saved: 1, duplicate: 0, skipped: 0 };
    throw new Error("unexpected message");
  });
  await tick(); await tick();
  emit(view.document.querySelector("#import")!, "click");
  await tick();
  view.scheduled.shift()!(); await tick(); await tick();
  assert.equal(view.document.querySelector("#candidate-list input"), null);
  assert.doesNotMatch(view.document.querySelector("#candidate-help")!.textContent!, /제외/);
});

test("history view recovers after a rejected status poll and safely retries scanning", async () => {
  let statusCalls = 0; let starts = 0;
  const view = page(async message => {
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: [] };
    if (message.type === "LOCAL_HISTORY_STATUS") {
      statusCalls += 1;
      if (statusCalls === 1) return { status: "SCANNING", progress: { phase: "pages", rows: 1, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0 } };
      throw new Error("temporary status failure");
    }
    if (message.type === "LOCAL_HISTORY_SCAN_START") { starts += 1; return ready; }
    throw new Error("unexpected message");
  });
  await tick(); await tick();
  view.scheduled.shift()!(); await tick(); await tick();
  assert.match(view.document.querySelector("#status")!.textContent!, /확인하지 못했습니다/);
  const scan = view.document.querySelector<HTMLButtonElement>("#scan")!;
  assert.equal(scan.disabled, false);
  emit(scan, "click"); await tick(); await tick();
  assert.equal(starts, 1);
  assert.ok(view.document.querySelector("#candidate-list input"));
});

test("history view reports a failed cancel request without leaving controls stuck", async () => {
  const view = page(async message => {
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: [] };
    if (message.type === "LOCAL_HISTORY_STATUS") return { status: "IMPORTING", completed: 0, total: 1, saved: 0, duplicate: 0, skipped: 0 };
    if (message.type === "LOCAL_HISTORY_CANCEL") throw new Error("gone");
    throw new Error("unexpected message");
  });
  await tick(); await tick();
  const cancel = view.document.querySelector<HTMLButtonElement>("#cancel")!;
  emit(cancel, "click"); await tick(); await tick();
  assert.match(view.document.querySelector("#status")!.textContent!, /중단 요청/);
  assert.equal(cancel.disabled, false);
});


test("ordinary selected import sends every selected candidate with actual count progress", async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...candidate, submissionId: String(index + 1) }));
  const imports: string[][] = [];
  const view = page(async message => {
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: [] };
    if (message.type === "LOCAL_HISTORY_STATUS") return { status: "READY", candidates: many, truncated: false };
    if (message.type === "LOCAL_HISTORY_IMPORT_START") { imports.push(message.submissionIds!); return { status: "IMPORTING", completed: 0, total: 12, saved: 0, duplicate: 0, skipped: 0 }; }
    throw new Error("unexpected message");
  }, { readTiming: async () => ({ version: 1, platform: "JUNGOL", count: 10, durationMs: 100_000, startedAt: 1_000, endedAt: 101_000 }) });
  await tick(); await tick();
  emit(view.document.querySelector("#import")!, "click"); await tick(); await tick();
  assert.deepEqual(imports, [Array.from({ length: 12 }, (_, index) => String(index + 1))]);
  assert.equal((view.document.querySelector("#import") as HTMLButtonElement).disabled, true);
  assert.match(view.document.querySelector("#progress")!.textContent!, /0\/12건.*0%/);
  assert.equal((view.document.querySelector("#candidates") as HTMLElement).hidden, true);
  assert.equal(view.document.querySelector("#timing-estimate"), null);
  assert.equal(view.document.querySelector("#measure"), null);
});

test("local timing estimate uses an ordinary completed sample and keeps a fixed terminal elapsed time after reopen", async () => {
  const sample = { version: 1, platform: "JUNGOL", count: 10, durationMs: 100_000, startedAt: 1_000, endedAt: 101_000 };
  const many = Array.from({ length: 10 }, (_, index) => ({ ...candidate, submissionId: String(index + 1) }));
  const terminal = { status: "DONE", completed: 10, total: 10, saved: 10, duplicate: 0, skipped: 0,
    startedAt: 1_000, endedAt: 66_000, timingSample: sample };
  const respond = async (message: { type: string }) => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : terminal;
  const first = page(respond, { now: () => 999_999, readTiming: async () => sample });
  await tick(); await tick();
  assert.equal(first.document.querySelector("#task-time")!.textContent, "진행 시간 01:05 / 예상 총 시간 01:05");
  // A fresh page instance receives the same terminal timestamps instead of inventing elapsed time from its own mount.
  const reopened = page(respond, { now: () => 4_000_000, readTiming: async () => sample });
  await tick(); await tick();
  assert.equal(reopened.document.querySelector("#task-time")!.textContent, "진행 시간 01:05 / 예상 총 시간 01:05");
  // Candidate discovery has no separate forecast, even with past import timing.
  const readyView = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : { status: "READY", candidates: many, truncated: false },
    { readTiming: async () => sample });
  await tick(); await tick(); await tick();
  assert.equal(readyView.document.querySelector("#timing-estimate"), null);
  assert.equal(readyView.document.querySelector<HTMLElement>("#task-time")!.hidden, true);
  const noSample = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : ready);
  await tick(); await tick();
  assert.equal(noSample.document.querySelector("#timing-estimate"), null);
  assert.equal(noSample.document.querySelector<HTMLElement>("#task-time")!.hidden, true);
});

test("waiting scan stage reports source visibility without inventing list progress", async () => {
  const waiting = { status: "SCANNING", startedAt: 1_000, progress: { phase: "pages", stage: "waiting-pages",
    rows: 37, pagesLoaded: 2, groupsExpanded: 0, groupsTotal: 0, lastProgressAt: 1_500, sourceVisibility: "hidden" } };
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : waiting, { now: () => 62_000 });
  await tick(); await tick();
  assert.match(view.document.querySelector("#task-stage")!.textContent!, /다음 목록 또는 마지막 목록.*백그라운드/);
  assert.equal(view.document.querySelector("#progress")!.textContent, "목록 행 37개 · 2개 페이지를 확인했습니다.");
  assert.equal(view.document.querySelector("#task-time")!.textContent, "");
  assert.equal((view.document.querySelector("#task-time") as HTMLElement).hidden, true);
});

test("history view remains retryable before entering submissions and after connection failure", async () => {
  let scanCalls = 0;
  const view = page(async message => {
    if (message.type === "LOCAL_HISTORY_IDS") return { submissionIds: [] };
    if (message.type === "LOCAL_HISTORY_STATUS") return { status: "TAB_NOT_FOUND" };
    return [{ status: "TAB_NOT_FOUND" }, { status: "CONNECTION_FAILED" }, ready][scanCalls++];
  });
  await tick(); await tick();
  const scan = view.document.querySelector<HTMLButtonElement>("#scan")!;
  for (const expected of [/프로필 → 내 정보 → 제출현황/, /연결하지 못했습니다/]) {
    emit(scan, "click"); await tick(); await tick();
    assert.equal(scan.disabled, false);
    assert.match(view.document.querySelector("#status")!.textContent!, expected);
    assert.equal(view.document.querySelector<HTMLElement>("#candidates")!.hidden, true);
  }
  emit(scan, "click"); await tick(); await tick();
  assert.equal(scanCalls, 3);
  assert.equal(view.document.querySelector<HTMLElement>("#candidates")!.hidden, false);
  assert.equal(view.document.querySelector<HTMLButtonElement>("#import")!.disabled, false);
});

test("local import shows elapsed over estimated total and pending time does not inflate the settled-item mean", async () => {
  let clock = 5_000;
  let state = { status: "IMPORTING", total: 4, completed: 0, saved: 0, duplicate: 0,
    startedAt: 1_000, lastProgressAt: 1_000 };
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : state,
    { now: () => clock });
  await tick(); await tick();
  assert.equal(view.document.querySelector("#task-time")!.textContent, "진행 시간 00:04 / 예상 총 시간 ?시간");
  state = { ...state, completed: 1, saved: 1, lastProgressAt: 11_000 }; clock = 12_000;
  view.scheduled.shift()!(); await tick(); await tick();
  assert.equal(view.document.querySelector("#task-time")!.textContent, "진행 시간 00:11 / 예상 총 시간 00:40");
  clock = 19_000;
  view.scheduled.shift()!(); await tick(); await tick();
  assert.equal(view.document.querySelector("#task-time")!.textContent, "진행 시간 00:18 / 예상 총 시간 00:40");
  assert.match(view.document.querySelector("#progress")!.textContent!, /1\/4건.*25%/);
  state = { ...state, completed: 2, saved: 2, lastProgressAt: 15_000 };
  view.scheduled.shift()!(); await tick(); await tick();
  assert.equal(view.document.querySelector("#task-time")!.textContent, "진행 시간 00:18 / 예상 총 시간 00:28");
});


test("candidate and completed import summaries keep unique problems separate from submissions", async () => {
  const candidates = [candidate, { ...candidate, submissionId: "102" }];
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } :
    { status: "READY", candidates, truncated: false });
  await tick(); await tick();
  assert.match(view.document.querySelector("#candidate-help")!.textContent!, /후보 문제 1건 · 제출 2건/);

  const done = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } :
    { status: "DONE", completed: 3, total: 3, saved: 2, duplicate: 1, skipped: 0,
      problemCount: 2, submissionCount: 3, startedAt: 1, endedAt: 2 });
  await tick(); await tick();
  assert.equal(done.document.querySelector("#status")!.textContent,
    "로컬 저장 완료 · 문제 2건 · 제출 3건 · 새로 저장 2건 · 이미 저장됨 1건");
});


test("interrupted imports retain settled problem and submission results with actual progress", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } :
    { status: "INTERRUPTED", completed: 2, total: 3, saved: 1, duplicate: 1, skipped: 0,
      problemCount: 1, submissionCount: 2, startedAt: 1, endedAt: 2 });
  await tick(); await tick();
  assert.equal(view.document.querySelector("#status")!.textContent,
    "수집이 중단되었습니다. 현재까지 문제 1건 · 제출 2건 · 새로 저장 1건 · 이미 저장됨 1건");
  assert.equal(view.document.querySelector("#progress")!.textContent, "2/3건 처리했습니다. (66%)");
  assert.equal((view.document.querySelector("#task-progress") as HTMLProgressElement).hidden, false);
  assert.equal(view.document.querySelector("#timing-estimate"), null);
});

test("first-item failure reports the failed phase without a redundant progress explanation", async () => {
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } :
    { status: "FAILED", failureReason: "STORE_REJECTED", completed: 0, total: 120, saved: 0, duplicate: 0,
      startedAt: 1_000, endedAt: 2_000 });
  await tick(); await tick();
  assert.match(view.document.querySelector("#status")!.textContent!, /로컬 저장 요청이 거부/);
  assert.equal(view.document.querySelector("#task-stage")!.textContent, "");
  assert.equal(view.document.querySelector("#progress")!.textContent, "0/120건 처리했습니다. (0%)");
});
