import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountHistory } from "../src/history";

const candidate = { submissionId: "101", problemNumber: "1000", title: "테스트", executionTime: 1, memoryValue: 2 };
const ready = { status: "READY", candidates: [candidate], truncated: false };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function emit(element: Element, type: string) {
  const EventConstructor = element.ownerDocument.defaultView!.Event;
  element.dispatchEvent(new EventConstructor(type));
}

function page(send: (message: { type: string; submissionIds?: string[] }) => Promise<unknown>) {
  const { document } = parseHTML(`<!doctype html><body>
    <button id="scan"></button><button id="cancel" hidden></button><button id="import"></button>
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
  assert.equal((view.document.querySelector("#import") as HTMLButtonElement).disabled, true);
  assert.equal((view.document.querySelector("#task-progress") as HTMLProgressElement).hidden, false);
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
