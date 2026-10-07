import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { installProgrammersHistorySource } from "../src/programmersHistorySource";
import { installMainWorldSync, syncProgrammersHistoryModel } from "../src/mainWorld";

const lesson = "389481", account = "947840", createdAt = "2026-09-21T16:43:28.310+09:00";
const location = new URL(`https://school.programmers.co.kr/learn/courses/30/lessons/${lesson}`) as unknown as Location;
const endpoint = `https://programmers.co.kr/api/v1/school/open-challenge/lessons/${lesson}/submissions?page=1&perPage=10`;
function fixture() {
  const { document } = parseHTML(`<html><body>
    <div class="challenge-content lesson-algorithm-main-section" data-user-id="${account}" data-challengeable-id="26803"></div>
    <h1 class="challenge-title">봉인된 주문</h1>
    <div data-challengeable-submission-history-component data-user-id="${account}" data-lesson-id="${lesson}">
      <div class="submission-history-wrapper"><div class="Headerstyle__TotalSubmissionCount">1개의 제출</div>
        <div data-hackle-value='${JSON.stringify({ key: "open_challenge_lesson_submission_history_refresh_clicked", properties: { total_entries: 1, lesson_id: lesson } })}'></div>
        <div class="SubmissionListstyle__ListRow" data-hackle-value='${JSON.stringify({ key: "open_challenge_lesson_submission_history_list_item_toggle_clicked", properties: { lesson_id: lesson, created_at: createdAt, language: "java", score: 100, is_perfect_score: true } })}'>
          <div class="ListItemCodeWrapper"><div class="monaco-editor" role="code" data-uri="inmemory://model/1"></div></div>
        </div><button data-testid="page-active">1</button>
      </div>
    </div></body></html>`);
  let opens = 0;
  class Xhr extends EventTarget {
    status = 200; responseType = ""; responseText = ""; responseURL = "";
    open(method: string, url: string, ..._rest: unknown[]) { opens++; this.responseURL = url; }
    finish(payload: unknown) { this.responseText = JSON.stringify(payload); this.dispatchEvent(new Event("load")); }
  }
  const window = { XMLHttpRequest: Xhr } as unknown as Window & { XMLHttpRequest: typeof XMLHttpRequest };
  const source = installProgrammersHistorySource(document, location, window);
  const payload = { page: 1, perPage: 10, submissions: [{ id: 123, createdAt, language: "java", score: 100, perfectScore: 100, code: "class Solution {\r\n\t// 원본\r\n}" }] };
  return { document, window, source, payload, Xhr, opens: () => opens };
}

test("ESM Monaco history uses the unchanged native response and exact selected row", () => {
  const f = fixture(); const xhr = new f.Xhr();
  try {
    assert.equal(f.opens(), 0, "installing the observer sends no requests");
    assert.equal(f.source.read("inmemory://model/1"), null);
    xhr.open("GET", endpoint); xhr.finish(f.payload);
    assert.equal(f.opens(), 1);
    const root = f.document.documentElement;
    root.dataset.codearchiveProgrammersHistoryUri = "inmemory://model/1";
    root.dataset.codearchiveProgrammersHistoryRequest = "inmemory://model/1:1";
    assert.equal(syncProgrammersHistoryModel(f.document, f.window, f.source.read), true);
    assert.equal(f.document.querySelector<HTMLTextAreaElement>("textarea[data-codearchive-programmers-history-source]")?.value, f.payload.submissions[0]!.code);
    assert.equal(f.source.read("inmemory://model/2"), null, "another editor cannot reuse the source");
    f.document.querySelector(".challenge-content")!.setAttribute("data-user-id", "999");
    assert.equal(f.source.read("inmemory://model/1"), null, "account changes invalidate access to the response");
  } finally { f.source.cleanup(); }
});

test("native source rejects redirects, wrong pages, duplicate tuples and non-perfect scores", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>, xhr: InstanceType<ReturnType<typeof fixture>["Xhr"]>) => { xhr.responseURL = endpoint.replace("programmers.co.kr", "example.com"); },
    (f: ReturnType<typeof fixture>) => { f.payload.page = 2; },
    (f: ReturnType<typeof fixture>) => { f.payload.submissions.push({ ...f.payload.submissions[0]! }); },
    (f: ReturnType<typeof fixture>) => { f.payload.submissions[0]!.score = 90; },
    (f: ReturnType<typeof fixture>) => { f.payload.submissions[0]!.createdAt = "2026-09-20T16:43:28.310+09:00"; }
  ]) {
    const f = fixture(); const xhr = new f.Xhr();
    try {
      xhr.open("GET", endpoint); mutate(f, xhr); xhr.finish(f.payload);
      assert.equal(f.source.read("inmemory://model/1"), null);
    } finally { f.source.cleanup(); }
  }
});

test("observer cleanup restores the native API and ignores late or unrelated responses", () => {
  const f = fixture(); const xhr = new f.Xhr();
  xhr.open("POST", endpoint); xhr.finish(f.payload);
  assert.equal(f.source.read("inmemory://model/1"), null);
  xhr.open("GET", endpoint);
  f.source.cleanup(); xhr.finish(f.payload);
  assert.equal(f.source.read("inmemory://model/1"), null);
  xhr.open("GET", endpoint); assert.equal(f.opens(), 3);
});

test("MAIN retries a late native history response without a global Monaco API", async () => {
  const f = fixture(); f.source.cleanup();
  const cleanup = installMainWorldSync(f.document, location, f.window);
  try {
    const xhr = new f.Xhr(); xhr.open("GET", endpoint);
    const root = f.document.documentElement;
    root.dataset.codearchiveProgrammersHistoryRequest = "inmemory://model/1:1";
    root.dataset.codearchiveProgrammersHistoryUri = "inmemory://model/1";
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(root.getAttribute("data-codearchive-programmers-history-response"), null);
    xhr.finish(f.payload);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(f.document.querySelector<HTMLTextAreaElement>("textarea[data-codearchive-programmers-history-source]")?.value, f.payload.submissions[0]!.code);
  } finally { cleanup(); }
});
