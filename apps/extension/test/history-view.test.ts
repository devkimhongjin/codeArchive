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

function page(send: (message: { type: string; submissionIds?: string[] }) => Promise<unknown>) {
  const { document } = parseHTML(`<!doctype html><body>
    <button id="scan"></button><button id="cancel" hidden></button><button id="import"></button>
    <select id="platform"><option value="JUNGOL" selected>JUNGOL</option><option value="SWEA">SWEA</option><option value="PROGRAMMERS">PROGRAMMERS</option></select>
    <a id="history-page-link"></a><p id="platform-description"></p><p id="platform-help"></p>
    <select id="selection"><option value="all" selected>all</option><option value="latest">latest</option></select>
    <span id="status"></span><progress id="task-progress"></progress><p id="progress"></p>
    <section id="candidates" hidden><p id="candidate-help"></p><div id="candidate-list"></div></section>
  </body>`);
  const scheduled: (() => void)[] = [];
  mountHistory(document, { send: message => send(message as { type: string; submissionIds?: string[] }), schedule: work => { scheduled.push(work); return scheduled.length; } });
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

test("history page exposes all platform links and duplicate policies before scanning", () => {
  const html = readFileSync(new URL("../src/history.html", import.meta.url), "utf8");
  for (const platform of ["JUNGOL", "SWEA", "PROGRAMMERS"]) assert.match(html, new RegExp(`<option value="${platform}"`));
  for (const mode of ["all", "latest", "fastest", "lowest-memory"]) assert.match(html, new RegExp(`<option value="${mode}"`));
  assert.match(html, /id="history-page-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
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
