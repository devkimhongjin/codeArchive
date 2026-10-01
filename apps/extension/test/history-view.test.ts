import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { mountHistory } from "../src/history";

const candidate = { submissionId: "101", problemNumber: "1000", title: "테스트", executionTime: 1, memoryValue: 2 };
const ready = { status: "READY", candidates: [candidate], truncated: false };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
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
    <p id="timing-estimate"></p><section id="candidates" hidden><p id="candidate-help"></p><div id="candidate-list"></div></section>
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
  assert.match(html, /id="timing-estimate"/);
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

test("unsupported platforms navigate without dispatching Jungol collection commands", async () => {
  const calls: string[] = [];
  const view = page(async message => { calls.push(message.type); return message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : ready; });
  await tick(); await tick(); calls.length = 0;
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "SWEA"); await tick();
  assert.deepEqual(calls, []);
  assert.equal((view.document.querySelector("#scan") as HTMLButtonElement).disabled, true);
  assert.equal((view.document.querySelector("#selection") as HTMLSelectElement).disabled, false);
  assert.equal((view.document.querySelector("#history-page-link") as HTMLAnchorElement).href, "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do");
  assert.match(view.document.querySelector("#status")!.textContent!, /아직 지원하지 않습니다/);
});

test("late Jungol results are ignored after a platform switch and switching back reloads safely", async () => {
  let resolveIds!: (value: unknown) => void; let idCalls = 0; const calls: string[] = [];
  const view = page(message => {
    calls.push(message.type);
    if (message.type === "LOCAL_HISTORY_IDS") { idCalls += 1; return idCalls === 1 ? new Promise(resolve => { resolveIds = resolve; }) : Promise.resolve({ submissionIds: [] }); }
    return Promise.resolve(ready);
  });
  await tick();
  const platform = view.document.querySelector<HTMLSelectElement>("#platform")!;
  choose(platform, "PROGRAMMERS"); resolveIds!({ submissionIds: ["101"] }); await tick(); await tick();
  assert.equal(view.document.querySelector("#candidate-list input"), null);
  assert.match(view.document.querySelector("#status")!.textContent!, /아직 지원하지 않습니다/);
  choose(platform, "JUNGOL"); await tick(); await tick();
  assert.ok(calls.filter(type => type === "LOCAL_HISTORY_IDS").length >= 2);
  assert.ok(view.document.querySelector("#candidate-list input"));
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
  assert.match(view.document.querySelector("#candidate-help")!.textContent!, /제외/);
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
  assert.equal((view.document.querySelector("#timing-estimate") as HTMLElement).hidden, false);
  assert.equal(view.document.querySelector("#timing-estimate")!.textContent, "로컬 저장 예상: 02:00");
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
  assert.equal(first.document.querySelector("#task-time")!.textContent, "작업 시간 01:05");
  // A fresh page instance receives the same terminal timestamps instead of inventing elapsed time from its own mount.
  const reopened = page(respond, { now: () => 4_000_000, readTiming: async () => sample });
  await tick(); await tick();
  assert.equal(reopened.document.querySelector("#task-time")!.textContent, "작업 시간 01:05");
  // Loading candidates with that sample yields an estimate, while an absent sample remains explicit.
  const readyView = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : { status: "READY", candidates: many, truncated: false },
    { readTiming: async () => sample });
  await tick(); await tick(); await tick();
  assert.equal(readyView.document.querySelector("#timing-estimate")!.textContent, "로컬 저장 예상: 01:40");
  const noSample = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : ready);
  await tick(); await tick();
  assert.equal(noSample.document.querySelector("#timing-estimate")!.textContent, "실측 기록이 없어 예상 시간을 계산할 수 없습니다.");
});

test("waiting scan stage reports source visibility without inventing list progress", async () => {
  const waiting = { status: "SCANNING", startedAt: 1_000, progress: { phase: "pages", stage: "waiting-pages",
    rows: 37, pagesLoaded: 2, groupsExpanded: 0, groupsTotal: 0, lastProgressAt: 1_500, sourceVisibility: "hidden" } };
  const view = page(async message => message.type === "LOCAL_HISTORY_IDS" ? { submissionIds: [] } : waiting, { now: () => 62_000 });
  await tick(); await tick();
  assert.match(view.document.querySelector("#task-stage")!.textContent!, /다음 목록 또는 마지막 목록.*백그라운드/);
  assert.equal(view.document.querySelector("#progress")!.textContent, "목록 행 37개 · 2개 페이지를 확인했습니다.");
  assert.equal(view.document.querySelector("#task-time")!.textContent, "작업 시간 01:01");
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
  assert.equal((view.document.querySelector("#timing-estimate") as HTMLElement).hidden, true);
});
