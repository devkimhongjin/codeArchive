import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { readProgrammersAuxiliaryLesson } from "../src/content";
import { readProgrammersLessonHistory, readProgrammersSolvedListingPage } from "../src/historicalProgrammers";
import { programmersHistoricalSubmissionId } from "../src/historicalIdentity";

const lessonId = "389481";
const accountId = "947840";
const lessonUrl = `https://school.programmers.co.kr/learn/courses/30/lessons/${lessonId}`;
const locationFor = (href = lessonUrl): Location => new URL(href) as unknown as Location;
const timestamp = "2026-09-21T16:43:28.310+09:00";

type Row = { createdAt?: string; language?: string; score?: number; perfect?: boolean; lesson?: string };

function rowMarkup(row: Row = {}): string {
  return `<div class="SubmissionListstyle__ListRow" data-hackle-value='${JSON.stringify({
    key: "open_challenge_lesson_submission_history_list_item_toggle_clicked",
    properties: { lesson_id: row.lesson ?? lessonId, created_at: row.createdAt ?? timestamp, language: row.language ?? "java", score: row.score ?? 100, is_perfect_score: row.perfect ?? true }
  })}'>
    <div class="ListItemColumnWrapper">${row.createdAt ?? timestamp}</div><div class="ListItemCodeWrapper"><code>partial rendered source</code></div>
  </div>`;
}

function lessonDocument(options: { account?: string; historyAccount?: string; lesson?: string; challengeableLesson?: string; rows?: Row[]; title?: string; history?: boolean } = {}): Document {
  const account = options.account ?? accountId;
  const historyAccount = options.historyAccount ?? account;
  const rows = options.rows ?? [{}];
  const total = rows.length;
  return parseHTML(`<html><body>
    <div class="challenge-content lesson-algorithm-main-section" data-user-id="${account}" data-challengeable-id="${options.challengeableLesson ?? "26803"}"></div>
    <h1 class="challenge-title">${options.title ?? "가장 큰 수"}</h1><textarea id="code">CURRENT EDITOR MUST NOT BE USED</textarea>
    ${options.history === false ? "" : `<button class="submission-history-title">제출 이력</button>
      <div data-challengeable-submission-history-component data-user-id="${historyAccount}" data-lesson-id="${options.lesson ?? lessonId}">
        <div class="submission-history-wrapper"><div class="Headerstyle__TotalSubmissionCount">${total}개의 제출</div>
          <div data-hackle-value='${JSON.stringify({ key: "open_challenge_lesson_submission_history_refresh_clicked", properties: { total_entries: total, lesson_id: options.lesson ?? lessonId } })}'></div>
          ${rows.map(rowMarkup).join("")}<button data-testid="page-active">1</button><button aria-label="처음 페이지" disabled></button><button aria-label="이전 페이지" disabled></button><button aria-label="다음 페이지" disabled></button><button aria-label="마지막 페이지" disabled></button></div>
      </div>`}
  </body></html>`).document;
}

function installEditorOnClick(document: Document, uri = "inmemory://model/1"): void {
  const row = document.querySelector<HTMLElement>('[class*="SubmissionListstyle__ListRow"][data-hackle-value]')!;
  row.click = () => {
    if (!row.querySelector(".monaco-editor")) row.querySelector(".ListItemCodeWrapper")!.insertAdjacentHTML("beforeend",
      `<div class="monaco-editor" role="code" data-uri="${uri}"><div>partial lines</div></div>`);
  };
}

function bridge(document: Document, source = "class Solution { full original source; }") {
  return (uri: string, stamp: string) => {
    const target = document.querySelector<HTMLTextAreaElement>("textarea[data-codearchive-programmers-history-source]") ?? document.createElement("textarea");
    target.dataset.codearchiveProgrammersHistorySource = "";
    target.dataset.codearchiveProgrammersHistoryUri = uri;
    target.dataset.codearchiveProgrammersHistoryRequest = stamp;
    target.value = source;
    if (!target.parentElement) document.body.append(target);
    document.documentElement.setAttribute("data-codearchive-programmers-history-response", `${stamp}:1`);
  };
}

test("Programmers auxiliary preview parses the observed nested history metadata and exact derived key", async () => {
  const document = lessonDocument();
  const result = await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.accountId, accountId);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.submissionId, programmersHistoricalSubmissionId(accountId, lessonId, timestamp, "java"));
  assert.equal(result.candidates[0]?.score, 100);
});

test("Programmers SQL without a history component reports unsupported immediately without an editor fallback", async () => {
  const sqlLocation = locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/299310");
  const document = parseHTML(`<html><body><div class="challenge-content lesson-algorithm-main-section" data-user-id="947840" data-challengeable-id="829" data-challengeable-type="database"></div><h1 class="challenge-title">SQL 문제</h1><textarea id="code">SELECT current editor</textarea></body></html>`).document;
  let waits = 0;
  const result = await readProgrammersAuxiliaryLesson(document, sqlLocation, { lessonUrl: sqlLocation.href, mode: "preview" }, { sleep: async () => { waits++; } });
  assert.deepEqual(result, { status: "UNSUPPORTED_HISTORY", accountId: "947840", lessonId: "299310", title: "SQL 문제", candidates: [] });
  assert.equal(waits, 0);
  const foreignId = programmersHistoricalSubmissionId("111", "299310", timestamp, "sql")!;
  assert.deepEqual(await readProgrammersAuxiliaryLesson(document, sqlLocation, { lessonUrl: sqlLocation.href, mode: "import", submissionId: foreignId }), { status: "OWNERSHIP_UNVERIFIED" });
  document.querySelector(".challenge-content")!.setAttribute("data-challengeable-type", "algorithm");
  assert.equal((await readProgrammersAuxiliaryLesson(document, sqlLocation, { lessonUrl: sqlLocation.href, mode: "preview" }, { attempts: 1 })).status, "OWNERSHIP_UNVERIFIED");
});

test("Programmers auxiliary rejects mismatched accounts, lesson routes, malformed rows, and duplicate tuple identities", async () => {
  const foreign = lessonDocument({ historyAccount: "111" });
  assert.deepEqual(await readProgrammersAuxiliaryLesson(foreign, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "OWNERSHIP_UNVERIFIED" });
  const wrongLesson = lessonDocument({ lesson: "999" });
  assert.deepEqual(await readProgrammersAuxiliaryLesson(wrongLesson, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "OWNERSHIP_UNVERIFIED" });
  const mismatchedChallengeable = lessonDocument({ challengeableLesson: "not-an-id" });
  assert.deepEqual(await readProgrammersAuxiliaryLesson(mismatchedChallengeable, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "OWNERSHIP_UNVERIFIED" });
  const duplicate = lessonDocument({ rows: [{}, {}] });
  assert.equal(readProgrammersLessonHistory(duplicate, locationFor()).status, "AMBIGUOUS");
  assert.deepEqual(await readProgrammersAuxiliaryLesson(duplicate, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "AMBIGUOUS_HISTORY" });
  const malformed = lessonDocument({ rows: [{ score: 101 }] });
  assert.deepEqual(await readProgrammersAuxiliaryLesson(malformed, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "HISTORY_INCOMPLETE" });
  const knownAccountSubmission = programmersHistoricalSubmissionId(accountId, lessonId, timestamp, "java")!;
  assert.deepEqual(await readProgrammersAuxiliaryLesson(malformed, locationFor(), { lessonUrl, mode: "import", submissionId: knownAccountSubmission }, { attempts: 1 }), { status: "HISTORY_INCOMPLETE" });
  const foreignMalformed = lessonDocument({ account: "111", historyAccount: "111", rows: [{ score: 101 }] });
  assert.deepEqual(await readProgrammersAuxiliaryLesson(foreignMalformed, locationFor(), { lessonUrl, mode: "import", submissionId: knownAccountSubmission }, { attempts: 1 }), { status: "OWNERSHIP_UNVERIFIED" });
  const fractionalFailed = lessonDocument({ rows: [{ score: 99.5, perfect: false }] });
  const fractional = await readProgrammersAuxiliaryLesson(fractionalFailed, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 });
  assert.equal(fractional.status, "READY");
  if (fractional.status === "READY") assert.equal(fractional.candidates.length, 0);
  assert.deepEqual(await readProgrammersAuxiliaryLesson(lessonDocument(), locationFor(`${lessonUrl}?page=1`), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "TAB_NOT_FOUND" });
});

test("Programmers solved-list page waits for both page control and replacement rows", () => {
  const listingUrl = "https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1";
  const listingRows = (start: number, count: number) => Array.from({ length: count }, (_, index) => `<tr><td class="status solved"></td><td class="title"><a href="/learn/courses/30/lessons/${start + index}">문제 ${start + index}</a></td></tr>`).join("");
  const { document } = parseHTML(`<html><body><button>로그아웃</button><a href="https://programmers.co.kr/users/profile"></a><div class="total"><span class="text">21 문제</span></div>
    <table><tbody>${listingRows(100, 20)}</tbody></table><button data-testid="page-active">1</button><button aria-label="처음 페이지" disabled></button><button aria-label="다음 페이지"></button></body></html>`);
  const location = locationFor(listingUrl);
  const first = readProgrammersSolvedListingPage(document, location);
  assert.equal(first.status, "READY");
  if (first.status !== "READY") return;
  document.querySelector("[data-testid='page-active']")!.textContent = "2";
  assert.equal(readProgrammersSolvedListingPage(document, location).status, "PENDING", "a changed page button with old rows is not a new listing page");
  document.querySelector("tbody")!.innerHTML = listingRows(120, 1);
  const next = document.querySelector<HTMLButtonElement>("button[aria-label='다음 페이지']")!; next.disabled = true;
  const second = readProgrammersSolvedListingPage(document, location);
  assert.equal(second.status, "READY");
  if (second.status === "READY") assert.notEqual(second.signature, first.signature);
});

test("Programmers auxiliary waits for late history UI and returns an explicit empty history", async () => {
  const document = lessonDocument({ history: false });
  let sleeps = 0;
  const result = await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, {
    attempts: 3,
    sleep: async () => {
      if (++sleeps === 1) document.body.innerHTML = lessonDocument().body.innerHTML;
    }
  });
  assert.equal(result.status, "READY");
  const empty = lessonDocument({ rows: [] });
  empty.querySelectorAll("button").forEach(button => button.remove());
  empty.querySelector(".submission-history-wrapper")!.append("제출 이력이 없습니다");
  const emptyResult = await readProgrammersAuxiliaryLesson(empty, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 });
  assert.equal(emptyResult.status, "EMPTY");
  const foreignEmpty = lessonDocument({ account: "111", historyAccount: "111", rows: [] });
  foreignEmpty.querySelectorAll("button").forEach(button => button.remove());
  foreignEmpty.querySelector(".submission-history-wrapper")!.append("제출 이력이 없습니다");
  const emptyKnownAccountSubmission = programmersHistoricalSubmissionId(accountId, lessonId, timestamp, "java")!;
  assert.deepEqual(await readProgrammersAuxiliaryLesson(foreignEmpty, locationFor(), { lessonUrl, mode: "import", submissionId: emptyKnownAccountSubmission }, { attempts: 1 }), { status: "OWNERSHIP_UNVERIFIED" });
});

test("Programmers auxiliary traverses every history page and counts failed rows without offering them as AC candidates", async () => {
  const document = lessonDocument({ rows: [{}] });
  const wrapper = document.querySelector<HTMLElement>(".submission-history-wrapper")!;
  const pages: Row[][] = [
    [{}, { createdAt: "2026-09-21T16:43:27.310+09:00", score: 0, perfect: false }],
    [{ createdAt: "2026-09-21T16:43:26.310+09:00" }]
  ];
  const render = (page: number, total = 3) => {
    wrapper.innerHTML = `<div class="Headerstyle__TotalSubmissionCount">${total}개의 제출</div>
      <div data-hackle-value='${JSON.stringify({ key: "open_challenge_lesson_submission_history_refresh_clicked", properties: { total_entries: total, lesson_id: lessonId } })}'></div>
      ${pages[page - 1]!.map(rowMarkup).join("")}<button data-testid="page-active">${page}</button>
      <button aria-label="처음 페이지" ${page === 1 ? "disabled" : ""}></button><button aria-label="이전 페이지" ${page === 1 ? "disabled" : ""}></button>
      <button aria-label="다음 페이지" ${page === pages.length ? "disabled" : ""}></button><button aria-label="마지막 페이지" ${page === pages.length ? "disabled" : ""}></button>`;
    const next = wrapper.querySelector<HTMLButtonElement>("button[aria-label='다음 페이지']")!;
    next.addEventListener("click", () => { if (page < pages.length) render(page + 1, total); });
    const first = wrapper.querySelector<HTMLButtonElement>("button[aria-label='처음 페이지']")!;
    first.addEventListener("click", () => { if (page > 1) render(1, total); });
  };
  render(1);
  const result = await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 2 });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(candidate => candidate.score === 100));

  render(1, 4);
  assert.deepEqual(await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 2 }), { status: "HISTORY_INCOMPLETE" });

  pages[1] = [{ createdAt: "2026-09-21T16:43:27.310+09:00", score: 0, perfect: false }];
  render(1, 3);
  assert.deepEqual(await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 2 }), { status: "AMBIGUOUS_HISTORY" },
    "a duplicate failed row is still identity evidence and cannot be silently ignored");
});

test("Programmers auxiliary rejects a page control that advances before its rows are replaced", async () => {
  const document = lessonDocument({ rows: [{}, { createdAt: "2026-09-21T16:43:27.310+09:00", score: 0, perfect: false }] });
  const wrapper = document.querySelector<HTMLElement>(".submission-history-wrapper")!;
  wrapper.querySelector<HTMLElement>(".Headerstyle__TotalSubmissionCount")!.textContent = "3개의 제출";
  const refresh = wrapper.querySelector<HTMLElement>("[data-hackle-value]")!;
  refresh.setAttribute("data-hackle-value", JSON.stringify({ key: "open_challenge_lesson_submission_history_refresh_clicked", properties: { total_entries: 3, lesson_id: lessonId } }));
  const next = wrapper.querySelector<HTMLButtonElement>("button[aria-label='다음 페이지']")!;
  next.disabled = false;
  next.addEventListener("click", () => {
    wrapper.querySelector("[data-testid='page-active']")!.textContent = "2";
    next.disabled = true;
  });
  const result = await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 });
  assert.deepEqual(result, { status: "HISTORY_INCOMPLETE" });
});

test("Programmers auxiliary treats an account change during history pagination as ownership loss", async () => {
  const document = lessonDocument({ rows: [{}, { createdAt: "2026-09-21T16:43:27.310+09:00", score: 0, perfect: false }] });
  const wrapper = document.querySelector<HTMLElement>(".submission-history-wrapper")!;
  wrapper.querySelector<HTMLElement>(".Headerstyle__TotalSubmissionCount")!.textContent = "3개의 제출";
  wrapper.querySelector<HTMLElement>("[data-hackle-value]")!.setAttribute("data-hackle-value", JSON.stringify({ key: "open_challenge_lesson_submission_history_refresh_clicked", properties: { total_entries: 3, lesson_id: lessonId } }));
  const next = wrapper.querySelector<HTMLButtonElement>("button[aria-label='다음 페이지']")!;
  next.disabled = false;
  next.addEventListener("click", () => {
    document.querySelector(".challenge-content")!.setAttribute("data-user-id", "111");
    document.querySelector("[data-challengeable-submission-history-component]")!.setAttribute("data-user-id", "111");
    wrapper.querySelector("[data-testid='page-active']")!.textContent = "2";
    wrapper.querySelectorAll('[class*="SubmissionListstyle__ListRow"]').forEach(row => row.remove());
    wrapper.insertAdjacentHTML("beforeend", rowMarkup({ createdAt: "2026-09-21T16:43:26.310+09:00" }));
    next.disabled = true;
  });
  assert.deepEqual(await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "preview" }, { attempts: 1 }), { status: "OWNERSHIP_UNVERIFIED" });
});

test("Programmers auxiliary import uses only the selected matching Monaco bridge source and fabricates no metrics", async () => {
  const document = lessonDocument();
  installEditorOnClick(document);
  const oldSource = document.createElement("textarea"); oldSource.dataset.codearchiveProgrammersHistorySource = "";
  oldSource.dataset.codearchiveProgrammersHistoryUri = "inmemory://model/1"; oldSource.dataset.codearchiveProgrammersHistoryRequest = "inmemory://model/1:old";
  oldSource.value = "STALE SOURCE"; document.body.append(oldSource);
  document.documentElement.setAttribute("data-codearchive-programmers-history-response", "inmemory://model/1:old:1");
  const submissionId = programmersHistoricalSubmissionId(accountId, lessonId, timestamp, "java")!;
  let bridgeSawClearedState = false;
  const result = await readProgrammersAuxiliaryLesson(document, locationFor(), { lessonUrl, mode: "import", submissionId }, {
    attempts: 2, now: () => Date.UTC(2026, 9, 1), onBridgeRequested: (uri, stamp) => {
      bridgeSawClearedState = oldSource.value === "" && document.documentElement.getAttribute("data-codearchive-programmers-history-response") === null;
      bridge(document)(uri, stamp);
    }
  });
  assert.equal(result.status, "DONE");
  if (result.status !== "DONE") return;
  assert.equal(result.capture.sourceCode, "class Solution { full original source; }");
  assert.notEqual(result.capture.sourceCode, document.querySelector<HTMLTextAreaElement>("#code")!.value);
  assert.equal(result.capture.historicalSubmissionId, submissionId);
  assert.equal(result.capture.executionTime, undefined);
  assert.equal(result.capture.memoryUsage, undefined);
  assert.equal(result.capture.memoryValue, undefined);
  assert.equal(bridgeSawClearedState, true, "a prior URI/source/response cannot satisfy the new bridge request");
});

test("Programmers auxiliary rejects stale bridge data and account or row changes during the read", async () => {
  const submissionId = programmersHistoricalSubmissionId(accountId, lessonId, timestamp, "java")!;
  const stale = lessonDocument(); installEditorOnClick(stale);
  const staleResult = await readProgrammersAuxiliaryLesson(stale, locationFor(), { lessonUrl, mode: "import", submissionId }, {
    attempts: 2,
    onBridgeRequested: (uri, _stamp) => {
      const source = stale.createElement("textarea"); source.dataset.codearchiveProgrammersHistorySource = "";
      source.dataset.codearchiveProgrammersHistoryUri = "inmemory://model/99"; source.dataset.codearchiveProgrammersHistoryRequest = "old";
      source.value = "stale source"; stale.body.append(source);
      stale.documentElement.setAttribute("data-codearchive-programmers-history-response", `${uri}:old:1`);
    }
  });
  assert.deepEqual(staleResult, { status: "SOURCE_UNAVAILABLE" });

  const accountChanged = lessonDocument(); installEditorOnClick(accountChanged);
  const accountResult = await readProgrammersAuxiliaryLesson(accountChanged, locationFor(), { lessonUrl, mode: "import", submissionId }, {
    attempts: 2,
    onBridgeRequested: (uri, stamp) => {
      accountChanged.querySelector("[data-challengeable-submission-history-component]")!.setAttribute("data-user-id", "111");
      bridge(accountChanged)(uri, stamp);
    }
  });
  assert.deepEqual(accountResult, { status: "OWNERSHIP_UNVERIFIED" });

  const routeChanged = lessonDocument(); installEditorOnClick(routeChanged);
  const route = locationFor();
  const routeResult = await readProgrammersAuxiliaryLesson(routeChanged, route, { lessonUrl, mode: "import", submissionId }, {
    attempts: 2,
    onBridgeRequested: (uri, stamp) => {
      route.pathname = "/learn/challenges";
      bridge(routeChanged)(uri, stamp);
    }
  });
  assert.deepEqual(routeResult, { status: "TAB_NOT_FOUND" });

  const rowChanged = lessonDocument(); installEditorOnClick(rowChanged);
  const rowResult = await readProgrammersAuxiliaryLesson(rowChanged, locationFor(), { lessonUrl, mode: "import", submissionId }, {
    attempts: 2,
    onBridgeRequested: (uri, stamp) => {
      rowChanged.querySelector("[data-hackle-value]")!.setAttribute("data-hackle-value", JSON.stringify({
        key: "open_challenge_lesson_submission_history_list_item_toggle_clicked",
        properties: { lesson_id: lessonId, created_at: "2026-09-22T16:43:28.310+09:00", language: "java", score: 100, is_perfect_score: true }
      }));
      bridge(rowChanged)(uri, stamp);
    }
  });
  assert.deepEqual(rowResult, { status: "SOURCE_UNAVAILABLE" });
});
