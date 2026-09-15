import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { ProgrammersAdapter } from "../src/adapters/programmers";
import { SweaAdapter } from "../src/adapters/swea";
import { collectAcceptedCaptureAttempt, createCapture } from "../src/capture";
import { IndexedDbCaptureStore, MemoryCaptureStore } from "../src/storage";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

function programmersDocument(code = "const original = 1;") {
  return parseHTML(`
    <html><body>
      <h1 class="challenge-title">Two Sum</h1>
      <nav class="challenge-nav"><button class="dropdown-toggle">JavaScript</button></nav>
      <textarea id="code" name="code">${code}</textarea>
      <button id="submit-code">제출 후 채점하기</button>
      <div id="modal-dialog" class="modal fade" role="dialog" aria-modal="false">
        <h4 class="modal-title">정답입니다!</h4>
      </div>
    </body></html>
  `);
}

function sweaDocument(code = "class Solution {}") {
  return parseHTML(`
    <html><body>
      <div class="problem_box"><h3>5678. A SWEA problem</h3></div>
      <input id="contestProbId" value="AV1234">
      <select id="selectCodeLang"><option selected>Java 17</option></select>
      <textarea id="textSource">${code}</textarea>
      <button id="submitButton">제출</button>
      <div class="popup_layer"><div><p class="txt"></p></div></div>
    </body></html>
  `);
}

test('a lost storage reply keeps the same capture ID across later observer checks', async () => {
  const { document } = programmersDocument();
  const adapter = new ProgrammersAdapter(document, locationFor('https://school.programmers.co.kr/learn/courses/30/lessons/1234'));
  adapter.beginSubmissionAttempt();
  const modal = document.querySelector('#modal-dialog')!;
  modal.classList.add('show');
  modal.setAttribute('aria-modal', 'true');
  const first = collectAcceptedCaptureAttempt(adapter);
  assert.ok(first);
  const store = new MemoryCaptureStore();
  await store.putCapture(first.capture); // persistence succeeds but caller loses reply
  const retry = collectAcceptedCaptureAttempt(adapter, new Date(Date.now() + 1000));
  assert.ok(retry);
  assert.equal(retry.capture.captureId, first.capture.captureId);
  await store.putCapture(retry.capture);
  assert.equal(await store.countPending(), 1);
  adapter.consumeSubmissionResult(retry.detection);
  assert.equal(collectAcceptedCaptureAttempt(adapter), null);
});

test("Programmers ignores a stale accepted dialog and captures a new result with submit snapshot", () => {
  const { document } = programmersDocument();
  const location = locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/1234");
  const adapter = new ProgrammersAdapter(document, location, 30_000, () => Date.parse("2026-01-01T00:00:02.000Z"));
  const stale = document.querySelector("#modal-dialog") as HTMLElement;
  stale.classList.add("show");
  stale.setAttribute("aria-modal", "true");
  adapter.beginSubmissionAttempt(new Date());
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true }), null);

  stale.classList.remove("show");
  stale.setAttribute("aria-modal", "false");
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true }), null);
  (document.querySelector("#code") as HTMLTextAreaElement).value = "const changedAfterSubmit = 2;";
  stale.classList.add("show");
  stale.setAttribute("aria-modal", "true");

  const collected = collectAcceptedCaptureAttempt(adapter, new Date("2026-01-01T00:00:02.000Z"));
  assert.ok(collected);
  assert.equal(collected.capture.platform, "PROGRAMMERS");
  assert.equal(collected.capture.problemNumber, "1234");
  assert.equal(collected.capture.sourceCode, "const original = 1;");
  assert.equal(collected.capture.result, "ACCEPTED");
});

test("Programmers binds optional performance only to a changed current result group", () => {
  const { document } = programmersDocument();
  document.body.insertAdjacentHTML("beforeend", '<div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (9ms, 9MB)</td></tr></tbody></table></div>');
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/1234"));
  adapter.beginSubmissionAttempt();
  document.querySelector(".console-test-group tbody")!.innerHTML = '<tr><td class="result passed">통과 (2ms, 4MB)</td></tr><tr><td class="result passed">통과 (3ms, 6MB)</td></tr>';
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  const collected = collectAcceptedCaptureAttempt(adapter);
  assert.deepEqual(collected?.capture.executionTime, 5);
  assert.deepEqual(collected?.capture.memoryUsage, 5);
});

test("SWEA captures only a newly observed literal PASS입니다. result", () => {
  const { document } = sweaDocument();
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1234"));
  adapter.beginSubmissionAttempt(new Date());
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true }), null);
  const popup = document.querySelector(".popup_layer") as HTMLElement;
  popup.classList.add("show");
  popup.querySelector(".txt")!.textContent = "PASS입니다.";
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true })?.accepted, true);
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true })?.accepted, true);

  const bad = document.createElement("div");
  bad.className = "popup_layer show";
  bad.innerHTML = "<div><p class=\"txt\">PASS입니다. 컴파일 오류</p></div>";
  popup.classList.remove("show");
  document.body.append(bad);
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true }), null);
});

test("accepted capture never substitutes code that became available after submission", () => {
  const { document } = sweaDocument("");
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1234"));
  adapter.beginSubmissionAttempt(new Date());
  (document.querySelector("#textSource") as HTMLTextAreaElement).value = "const notSubmitted = true;";
  const popup = document.querySelector(".popup_layer") as HTMLElement;
  popup.classList.add("show");
  popup.querySelector(".txt")!.textContent = "PASS입니다.";
  assert.equal(collectAcceptedCaptureAttempt(adapter), null);
});

test("SWEA preserves the submitted snapshot when the editor changes before PASS", () => {
  const { document } = sweaDocument("const submitted = true;");
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1234"));
  adapter.beginSubmissionAttempt();
  (document.querySelector("#textSource") as HTMLTextAreaElement).value = "const notSubmitted = true;";
  const popup = document.querySelector(".popup_layer") as HTMLElement;
  popup.classList.add("show");
  popup.querySelector(".txt")!.textContent = "PASS입니다.";
  const collected = collectAcceptedCaptureAttempt(adapter);
  assert.equal(collected?.capture.sourceCode, "const submitted = true;");
});

test("a MAIN-world editor sync failure prevents stale source capture", () => {
  const { document } = sweaDocument("stale source");
  document.documentElement.setAttribute("data-codearchive-editor-sync", "failed:123");
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1234"));
  adapter.beginSubmissionAttempt();
  const popup = document.querySelector(".popup_layer") as HTMLElement;
  popup.classList.add("show");
  popup.querySelector(".txt")!.textContent = "PASS입니다.";
  assert.equal(collectAcceptedCaptureAttempt(adapter), null);
});

test("consuming a capture closes the attempt and blocks a remounted duplicate", () => {
  const { document } = programmersDocument();
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/1234"));
  adapter.beginSubmissionAttempt();
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  const first = collectAcceptedCaptureAttempt(adapter);
  assert.ok(first);
  adapter.consumeSubmissionResult(first.detection);
  dialog.replaceWith(dialog.cloneNode(true));
  assert.equal(collectAcceptedCaptureAttempt(adapter), null);
});

test("an older async save cannot consume a newer submit attempt", () => {
  const { document } = programmersDocument();
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/1234"));
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  adapter.beginSubmissionAttempt();
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  const first = collectAcceptedCaptureAttempt(adapter);
  assert.ok(first);

  // A second click can begin while the first STORE_CAPTURE is still pending.
  adapter.beginSubmissionAttempt();
  adapter.consumeSubmissionResult(first.detection);
  dialog.classList.remove("show");
  dialog.setAttribute("aria-modal", "false");
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true }), null);
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  assert.ok(collectAcceptedCaptureAttempt(adapter));
});

test("expired and page-changed attempts fail closed", () => {
  const { document } = programmersDocument();
  let now = 1_000;
  const location = locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/1234");
  const adapter = new ProgrammersAdapter(document, location, 1_000, () => now);
  adapter.beginSubmissionAttempt(new Date(now));
  now += 1_001;
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  assert.equal(adapter.detectSubmissionResult({ freshOnly: true }), null);
});

test("IndexedDB store keeps captures pending until an issued ACK marks them synced", async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  const store = new IndexedDbCaptureStore({
    databaseName: `codearchive-test-${Date.now()}-${Math.random()}`,
    indexedDb: indexedDB
  });
  const previous = globalThis.IDBKeyRange;
  (globalThis as typeof globalThis & { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  try {
    const capture = createCapture({
      platform: "SWEA",
      problemNumber: "1",
      title: "One",
      problemUrl: "https://swexpertacademy.com/problem/1",
      language: "Java",
      sourceCode: "class Solution {}",
      result: "ACCEPTED"
    });
    assert.ok(capture);
    assert.deepEqual(await store.putCapture(capture), { created: true });
    assert.deepEqual(await store.putCapture(capture), { created: false });
    assert.equal(await store.countPending(), 1);
    assert.equal((await store.listPending())[0]?.captureId, capture.captureId);
    assert.deepEqual(await store.markSynced([capture.captureId]), [capture.captureId]);
    assert.equal(await store.countPending(), 0);
  } finally {
    (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange = previous;
  }
});

test("memory store defaults both automation flags off and never enables GitHub without a target", async () => {
  const store = new MemoryCaptureStore();
  assert.deepEqual(await store.getSettings(), {
    autoSyncEnabled: false,
    githubAutoCommitEnabled: false,
    githubTargetConfigured: false
  });
  const settings = await store.updateSettings({ githubAutoCommitEnabled: true });
  assert.equal(settings.githubAutoCommitEnabled, false);
});
