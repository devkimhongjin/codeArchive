import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { hydrateSweaCandidate, hydrateSweaCandidateResult, loadSweaHistoryPreview, previewSweaProblems } from "../src/historicalSwea";

const origin = "https://swexpertacademy.com";
const location = { origin, pathname: "/main/userpage/code/userSubmitProblem.do", href: `${origin}/main/userpage/code/userSubmitProblem.do` } as Location;
const uid = "UserA123", nick = "fixture-user";
const response = (html: string, url: string, ok = true) => ({ ok, url, text: async () => html } as Response);

function listPage(page: number, total = 40) {
  const cards = Array.from({ length: Math.min(20, total - (page - 1) * 20) }, (_, index) => { const number = (page - 1) * 20 + index + 1; const key = `Key${String(number).padStart(8, "A")}`;
    return `<div class="widget-list solvingclub"><div class="widget-box-sub"><div class="widget-header-sub"><span class="header-caption"><span class="week_num">${number}.</span><span class="week_text"><a onclick="javascript:fn_move_prob('${key}','N','CODE','','${key}','')">Problem ${number}</a></span></span></div></div></div>`; }).join("");
  return `<div class="my-login"><span class="name hidden-sm-down">${nick}</span></div><div class="mypage_wrap"><div class="my_label"><span class="nick">${nick}</span></div></div>
    <form id="searchForm"><input name="userId" value="${uid}"><input name="pageIndex" value="${page}"><input name="rowNum" value="20"></form><form id="solvingForm"><input name="userId" value="${uid}"></form><h2 class="club_box_tit">제출한 Problem(${total})</h2>${cards}<nav aria-label="Page navigation"><a href="javascript:document.searchForm.pageIndex.value=2;javascript:fn_search();">2</a></nav>`;
}
function row(problem: number, ordinal: number, pass: boolean, owner = uid) { const id = `Submission${String(problem).padStart(4, "0")}${String(ordinal).padStart(4, "0")}`;
  return `<div class="problem_smt"><a href="javascript:codeview('${id}')">code</a><div class="submitter"><div class="smt_txt"><dt><a onclick="userInformationPopup('${owner}')">${nick}</a></dt><dd>제출일 : 2026-09-28 08:26</dd></div></div><div class="info"><ul><li><span>JAVA</span><span>언어</span></li><li><span>102,076kb</span><span>메모리</span></li><li><span>669ms</span><span>실행시간</span></li><li><span>5B</span><span>코드길이</span></li><li><span class="txt-success">${pass ? "Pass" : "Fail"}</span><span>결과</span></li></ul></div></div>`; }
function history(problem: number, page: number, owner = uid, header = nick) { const rows = page === 1 ? Array.from({ length: 20 }, (_, index) => row(problem, index + 1, index === 0, owner)).join("") : row(problem, 21, false, owner);
  return `<div class="my-login"><span class="name hidden-sm-down">${header}</span></div><form id="problemForm"><input name="contestProbId" value="Key${String(problem).padStart(8, "A")}"><input name="isChecked" value=""><input name="checkUserId" value=""></form><h5 class="section_tit">총 21회 제출</h5><div class="box-list-inner">${rows}</div><ul class="pagination"><li><a href="javascript:document.problemForm.pageIndex.value=2;searchSubmitHist();">2</a></li></ul>`; }
function detail(problem: number, body = "hello", title = `Problem ${problem}`, header = nick) { return `<div class="my-login"><span class="name hidden-sm-down">${header}</span></div><form id="problemForm"><input name="contestProbId" value="Key${String(problem).padStart(8, "A")}"><input name="contestHistoryId" value=""></form><div class="problem_box"><h1 class="problem_title">${problem}. ${title}<span class="badge">D3</span></h1></div><div class="box-list-inner"><div class="problem_smt_detail"><div class="submitter"><div class="smt_txt"><dt><a onclick="userInformationPopup('${uid}')">${nick}</a></dt><dd>제출일 : 2026-09-28 08:26</dd></div></div><div class="info"><ul><li><span>JAVA</span><span>언어</span></li><li><span>102,076kb</span><span>메모리</span></li><li><span>669ms</span><span>실행시간</span></li><li><span>5B</span><span>코드길이</span></li><li><span>Pass</span><span>결과</span></li></ul></div></div></div><textarea class="brush:java">${body}</textarea>`; }

function installedDomParser() { const prior = globalThis.DOMParser; Object.assign(globalThis, { DOMParser: parseHTML("<html></html>").window.DOMParser }); return () => Object.assign(globalThis, { DOMParser: prior }); }

test("SWEA preserves raw source CRLF and initial LF while rejecting a real length mismatch", async () => {
  const restore = installedDomParser();
  try {
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", userProblem: true, language: "JAVA", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: 9 };
    const source = "\nhi\r\nbye\n";
    const markup = detail(1, source).replace('id="problemForm"', 'id="contestProbForm"').replace("5B", "9B");
    const captured = await hydrateSweaCandidate(candidate, { userId: uid, nickname: nick }, async url => response(markup, url));
    assert.equal(captured?.sourceCode, source);
    assert.equal(await hydrateSweaCandidate({ ...candidate, codeByteLength: 10 }, { userId: uid, nickname: nick }, async url => response(markup, url)), null);
  } finally { restore(); }
});

test("SWEA template indentation is removed only when native bytes select one complete source", async () => {
  const restore = installedDomParser();
  try {
    const code = "import X;\n\nclass Main {\n\tint x = 1;\n}\n";
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", userProblem: true, language: "JAVA", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: code.length };
    const markup = detail(1, `\n\t\t\t\t${code}\t\t\t`).replace('id="problemForm"', 'id="contestProbForm"').replace("5B", `${code.length}B`);
    const captured = await hydrateSweaCandidate(candidate, { userId: uid, nickname: nick }, async url => response(markup, url));
    assert.equal(captured?.sourceCode, code, "interior tabs, blank lines and the submitted final newline remain intact");
    assert.equal(await hydrateSweaCandidate({ ...candidate, codeByteLength: code.length - 3 }, { userId: uid, nickname: nick }, async url => response(markup, url)), null);
  } finally { restore(); }
});

test("SWEA refuses equally sized boundary interpretations rather than guessing the original", async () => {
  const restore = installedDomParser();
  try {
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", language: "JAVA", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: 7 };
    const result = await hydrateSweaCandidateResult(candidate, { userId: uid, nickname: nick }, async url => response(detail(1, " \thello \t").replace("5B", "7B"), url));
    assert.deepEqual(result, { status: "SOURCE_UNAVAILABLE", verificationFailure: "length" });
  } finally { restore(); }
});

const clubContext = { solveclubId: "FixtureClub123", probBoxId: "FixtureBox456", problemBoxTitle: " [난이도 상] SW 전공 자율" };
function clubPage(page: number) {
  // The observed five-page profile has one BOX card on page 3 and eight on
  // page 4. Both N and Y problems use club routes, independently of the flag.
  const clubNumbers = new Set([41, 61, 62, 63, 64, 65, 66, 67, 68]);
  return listPage(page, 95).replace(/fn_move_prob\('(Key[A0-9]+)','N','CODE','','\1',''\)/g, (action, key: string) =>
    clubNumbers.has(Number(key.replace(/\D/g, ""))) ? `fn_move_prob('${key}','${key.endsWith("3") ? "Y" : "N"}','BOX','${clubContext.solveclubId}','${clubContext.probBoxId}','${clubContext.problemBoxTitle}')` : action);
}
function clubMarkup(markup: string): string {
  return markup.replace('<form id="problemForm">', `<form id="problemForm"><input name="solveclubId" value="${clubContext.solveclubId}"><input name="probBoxId" value="${clubContext.probBoxId}">`);
}

test("SWEA traverses 95 mixed CODE and solving-club problems without losing nine BOX cards", async () => {
  const restore = installedDomParser();
  try {
    let clubRequests = 0;
    const result = await loadSweaHistoryPreview(parseHTML(clubPage(4)).document, location, async (url, init) => {
      if (url.includes("userSubmitProblem")) return response(clubPage(Number(new URL(url).searchParams.get("pageIndex"))), url);
      const form = new URLSearchParams(String(init?.body));
      const number = Number((form.get("contestProbId") ?? "").replace(/\D/g, ""));
      const markup = history(number, Number(form.get("pageIndex")));
      if (form.has("solveclubId")) {
        clubRequests++;
        assert.equal(new URL(url).pathname, "/main/talk/solvingClub/problemSubmitHistory.do");
        assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "include");
        assert.equal(form.get("nickName"), nick); assert.equal(form.has("checkUserId"), false);
        assert.equal(form.get("solveclubId"), clubContext.solveclubId);
        assert.equal(form.get("probBoxId"), clubContext.probBoxId);
        assert.equal(form.get("problemBoxTitle"), clubContext.problemBoxTitle);
        assert.equal(form.get("problemBoxCnt"), "0");
        return response(clubMarkup(markup), url);
      }
      return response(markup, url);
    });
    assert.equal(result.status, "READY"); assert.equal(clubRequests, 18);
    if (result.status === "READY") {
      assert.equal(result.candidates.length, 95);
      assert.equal(result.candidates.filter(item => item.solvingClub).length, 9);
      assert.ok(result.candidates.find(item => item.problemNumber === "63")?.userProblem);
    }
  } finally { restore(); }
});

test("SWEA never accepts a foreign owner or a changed club/box from nickname-filtered histories", async () => {
  const restore = installedDomParser();
  try {
    const source = parseHTML(listPage(1, 1).replace(",'N','CODE','','KeyAAAAAAA1',''", `,'N','BOX','${clubContext.solveclubId}','${clubContext.probBoxId}','${clubContext.problemBoxTitle}'`)).document;
    const foreign = await loadSweaHistoryPreview(source, location, async url => response(clubMarkup(history(1, 1, "OtherUser")), url));
    assert.equal(foreign.status, "OWNERSHIP_UNVERIFIED");
    const changed = await loadSweaHistoryPreview(source, location, async url => response(clubMarkup(history(1, 1)).replace(clubContext.probBoxId, "OtherBox"), url));
    assert.equal(changed.status, "SCAN_INCOMPLETE");
    assert.equal(changed.failureReason, "HISTORY_PAGE_INCOMPLETE");
    const hostile = parseHTML(listPage(1, 1).replace("fn_move_prob(", "otherAction();fn_move_prob(")).document;
    assert.equal(previewSweaProblems(hostile, location)?.problems.length, 0);
  } finally { restore(); }
});

test("SWEA reads public and club histories of the same problem and deduplicates identical native submissions", async () => {
  const restore = installedDomParser();
  try {
    const source = listPage(1, 2).replace(/KeyAAAAAAA2/g, "KeyAAAAAAA1").replace(/2\.\<\/span\>/g, "1.</span>").replace(/Problem 2/g, "Problem 1")
      .replace("fn_move_prob('KeyAAAAAAA1','N','CODE','','KeyAAAAAAA1','')", `fn_move_prob('KeyAAAAAAA1','N','BOX','${clubContext.solveclubId}','${clubContext.probBoxId}','${clubContext.problemBoxTitle}')`);
    let histories = 0; const progress: {problems: number; historiesRead?: number; historiesTotal?: number}[] = [];
    const result = await loadSweaHistoryPreview(parseHTML(source).document, location, async (url, init) => {
      histories++;
      const form = new URLSearchParams(String(init?.body));
      const markup = history(1, Number(form.get("pageIndex")));
      return response(form.has("solveclubId") ? clubMarkup(markup) : markup, url);
    }, value => progress.push(value));
    assert.equal(histories, 4); assert.equal(result.status, "READY");
    if (result.status === "READY") assert.equal(result.candidates.length, 1);
    assert.equal(progress.at(-1)?.problems, 1); assert.equal(progress.at(-1)?.historiesRead, 2);
    const repeated = await loadSweaHistoryPreview(parseHTML(source).document, location, async url => response(clubMarkup(history(1, 1)), url));
    assert.equal(repeated.status, "SCAN_INCOMPLETE");
  } finally { restore(); }
});

test("SWEA club detail binds the club, box, title, source and native submission before capture", async () => {
  const restore = installedDomParser();
  try {
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", userProblem: true, solvingClub: clubContext, language: "JAVA", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: 5 };
    const markup = clubMarkup(detail(1).replace('>1. Problem 1<', '>Problem 1<'));
    const captured = await hydrateSweaCandidate(candidate, { userId: uid, nickname: nick }, async (url, init) => {
      assert.equal(new URL(url).pathname, "/main/talk/solvingClub/problemSubmitDetail.do");
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("contestHistoryId"), candidate.submissionId);
      assert.equal(form.get("solveclubId"), clubContext.solveclubId); assert.equal(form.get("nickName"), nick);
      return response(markup, url);
    });
    assert.equal(captured?.sourceCode, "hello");
    assert.equal(new URL(captured!.problemUrl).pathname, "/main/talk/solvingClub/problemView.do");
    for (const invalid of [markup.replace(clubContext.solveclubId, "OtherClub"), markup.replace(clubContext.probBoxId, "OtherBox"), markup.replace("Problem 1", "Other title"), markup.replace("hello", "helloo"), markup.replace(`userInformationPopup('${uid}')`, "userInformationPopup('OtherUser')"), markup.replace("08:26", "08:27")]) {
      assert.equal(await hydrateSweaCandidate(candidate, { userId: uid, nickname: nick }, async url => response(invalid, url)), null);
    }
  } finally { restore(); }
});

test("SWEA traverses complete My Page/history pages and accepts only raw Pass rows", async () => {
  const restore = installedDomParser();
  try {
    const fetcher = async (url: string, init?: RequestInit) => { const form = new URLSearchParams(String(init?.body ?? ""));
      if (url.includes("userSubmitProblem")) return response(listPage(Number(new URL(url).searchParams.get("pageIndex"))), url);
      const number = Number((form.get("contestProbId") ?? "").replace(/\D/g, "")); const page = Number(form.get("pageIndex") ?? 1);
      assert.equal(form.get("sortType"), "1", "standard histories use the actual form's submission-order value");
      return response(history(number, page), url);
    };
    const first = parseHTML(listPage(2)).document;
    const result = await loadSweaHistoryPreview(first, location, fetcher as typeof fetch);
    assert.equal(result.status, "READY"); if (result.status === "READY") assert.equal(result.candidates.length, 40);
  } finally { restore(); }
});

test("SWEA follows all five pageIndex pages including User Problem cards and the final partial page", async () => {
  const restore = installedDomParser();
  try {
    const mixedPage = (page: number) => listPage(page, 95).replace(/,'N','CODE'/g, ",'Y','CODE'");
    const seenPages: number[] = [];
    const result = await loadSweaHistoryPreview(parseHTML(mixedPage(2)).document, location, async (url, init) => {
      const request = new URL(url);
      if (request.pathname.endsWith("userSubmitProblem.do")) {
        const page = Number(request.searchParams.get("pageIndex")); seenPages.push(page);
        assert.equal(request.searchParams.get("problemTitle"), "");
        assert.equal(init?.credentials, "include");
        return response(mixedPage(page), url);
      }
      assert.equal(request.pathname, "/main/code/userProblem/userProblemSubmitHistory.do");
      assert.equal(init?.body, undefined); assert.notEqual(init?.method, "POST");
      assert.equal(request.searchParams.get("isChecked"), "checked");
      assert.equal(request.searchParams.get("checkUserId"), uid);
      const number = Number((request.searchParams.get("contestProbId") ?? "").replace(/\D/g, ""));
      const page = Number(request.searchParams.get("pageIndex"));
      return response(history(number, page).replace('id="problemForm"', 'id="contestProbForm"')
        .replace(/javascript:codeview\(/g, "javascript:fnShowCodeView(")
        .replace(/<dt><a ([^>]+)>([^<]+)<\/a><\/dt>/g, "<a $1><dt>$2</dt></a>")
        .replace(/실행시간/g, "시간"), url);
    });
    assert.deepEqual(seenPages, [1, 3, 4, 5]);
    assert.equal(result.status, "READY");
    if (result.status === "READY") { assert.equal(result.candidates.length, 95); assert.ok(result.candidates.every(item => item.userProblem)); assert.equal(result.candidates[0]?.executionTime, 669); }
  } finally { restore(); }
});

test("SWEA rejects repeated pageIndex content before traversing submission histories", async () => {
  const restore = installedDomParser();
  try {
    let requests = 0;
    const result = await loadSweaHistoryPreview(parseHTML(listPage(1)).document, location, async url => {
      requests++; assert.match(url, /pageIndex=2/); return response(listPage(1), url);
    });
    assert.equal(result.status, "SCAN_INCOMPLETE"); assert.equal(requests, 1);
    assert.equal(result.failureReason, "LIST_PAGE_INCOMPLETE"); assert.equal(result.failurePage, 2);
  } finally { restore(); }
});

test("SWEA uses the displayed active page when the next-search form field is stale", async () => {
  const restore = installedDomParser();
  try {
    const source = parseHTML(listPage(2).replace('name="pageIndex" value="2"', 'name="pageIndex" value="1"').replace('<nav aria-label="Page navigation">', '<nav aria-label="Page navigation"><li class="active">2 (current)</li>')).document;
    const requests: number[] = [];
    const result = await loadSweaHistoryPreview(source, location, async (url, init) => {
      if (url.includes("userSubmitProblem")) { const page = Number(new URL(url).searchParams.get("pageIndex")); requests.push(page); return response(listPage(page), url); }
      const form = new URLSearchParams(String(init?.body));
      return response(history(Number((form.get("contestProbId") ?? "").replace(/\D/g, "")), Number(form.get("pageIndex"))), url);
    });
    assert.equal(result.status, "READY"); assert.deepEqual(requests, [1]);
  } finally { restore(); }
});

test("SWEA keeps the exact problem and history page when an observed response is unavailable", async () => {
  const restore = installedDomParser();
  try {
    const result = await loadSweaHistoryPreview(parseHTML(listPage(1, 20)).document, location, async url => response("", url, false));
    assert.equal(result.status, "SCAN_INCOMPLETE");
    assert.equal(result.failureReason, "HISTORY_RESPONSE_UNAVAILABLE"); assert.equal(result.failedProblemNumber, "1"); assert.equal(result.failurePage, 1);
  } finally { restore(); }
});

test("SWEA normalizes a source listing using a non-default select page size", async () => {
  const restore = installedDomParser();
  try {
    const source = parseHTML(listPage(1).replace('<input name="rowNum" value="20">', '<select name="rowNum"><option value="40" selected>40개씩 보기</option></select>')).document;
    const seenPages: number[] = [];
    const result = await loadSweaHistoryPreview(source, location, async (url, init) => {
      if (url.includes("userSubmitProblem")) {
        const page = Number(new URL(url).searchParams.get("pageIndex")); seenPages.push(page);
        assert.equal(new URL(url).searchParams.get("rowNum"), "20");
        return response(listPage(page), url);
      }
      const form = new URLSearchParams(String(init?.body));
      return response(history(Number((form.get("contestProbId") ?? "").replace(/\D/g, "")), Number(form.get("pageIndex"))), url);
    });
    assert.equal(result.status, "READY"); assert.deepEqual(seenPages, [1, 2]);
  } finally { restore(); }
});

test("SWEA User Problem detail retains owner/code byte checks and its observed detail route", async () => {
  const restore = installedDomParser();
  try {
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", userProblem: true, language: "JAVA", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: 5 };
    const markup = detail(1).replace('id="problemForm"', 'id="contestProbForm"')
      .replace('<textarea class="brush:java">hello</textarea>', '<pre class="brush: java;">hello</pre>')
      .replace(/<dt><a ([^>]+)>([^<]+)<\/a><\/dt>/g, "<a $1><dt>$2</dt></a>");
    const fetcher = async (url: string, init?: RequestInit) => {
      assert.equal(new URL(url).pathname, "/main/code/userProblem/userProblemSubmitDetail.do");
      assert.equal(new URLSearchParams(String(init?.body)).get("contestHistoryId"), candidate.submissionId);
      return response(markup, url);
    };
    const capture = await hydrateSweaCandidate(candidate, { userId: uid, nickname: nick }, fetcher);
    assert.equal(capture?.sourceCode, "hello"); assert.match(capture?.problemUrl ?? "", /userProblem\/userProblemDetail/);
    assert.equal(await hydrateSweaCandidate(candidate, { userId: uid, nickname: nick }, async url => response(markup.replace("hello", "helloo"), url)), null);
  } finally { restore(); }
});

test("SWEA rejects owner/header changes and detail identity/source mismatches", async () => {
  const restore = installedDomParser();
  try {
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", language: "JAVA", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: 5, executionTime: 669, memoryValue: 102076 };
    const identity = { userId: uid, nickname: nick };
    const good = await hydrateSweaCandidate(candidate, identity, (async url => response(detail(1), String(url))) as typeof fetch);
    assert.ok(good);
    assert.equal(await hydrateSweaCandidate(candidate, identity, (async url => response(detail(1, "hello", "other"), String(url))) as typeof fetch), null);
    assert.equal(await hydrateSweaCandidate(candidate, identity, (async url => response(detail(1, "helloo"), String(url))) as typeof fetch), null);
    assert.equal(await hydrateSweaCandidate(candidate, identity, (async url => response(detail(1, "hello", "Problem 1", "other-account"), String(url))) as typeof fetch), null);
    assert.deepEqual(await hydrateSweaCandidateResult(candidate, identity, (async url => response(detail(1, "hello", "Problem 1", "other-account"), String(url))) as typeof fetch), { status: "OWNERSHIP_UNVERIFIED" });
    assert.deepEqual(await hydrateSweaCandidateResult(candidate, identity, (async () => response("", `${origin}/login`, false)) as typeof fetch), { status: "TAB_NOT_FOUND" });
  } finally { restore(); }
});

test("SWEA imports a Python submission displayed with the site's cpp syntax brush", async () => {
  const restore = installedDomParser();
  try {
    const candidate = { submissionId: "Submission00010001", problemNumber: "1", title: "Problem 1", contestProbId: "KeyAAAAAAA1", language: "Python", solvedAt: "2026-09-28 08:26:00.000+09:00", codeByteLength: 5 };
    const markup = detail(1).replace("JAVA", "Python").replace("brush:java", "brush:cpp");
    const identity = { userId: uid, nickname: nick };
    const captured = await hydrateSweaCandidate(candidate, identity, async url => response(markup, url));
    assert.equal(captured?.language, "Python"); assert.equal(captured?.sourceCode, "hello");
    for (const invalid of [markup.replace("Python", "JAVA"), markup.replace("hello", "helloo"), markup.replace("Pass", "Fail"), markup.replace("08:26", "08:27"), markup.replace(`userInformationPopup('${uid}')`, "userInformationPopup('OtherUser')")])
      assert.equal(await hydrateSweaCandidate(candidate, identity, async url => response(invalid, url)), null);
  } finally { restore(); }
});

test("SWEA never reports ready after a missing page, redirect, or other owner", async () => {
  const restore = installedDomParser();
  try {
    const first = parseHTML(listPage(1)).document;
    const missing = await loadSweaHistoryPreview(first, location, (async (url, init) => {
      if (String(url).includes("userSubmitProblem") && new URL(String(url)).searchParams.get("pageIndex") === "2") return response("", `${origin}/login`, false);
      const form = new URLSearchParams(String(init?.body ?? "")); return response(history(Number((form.get("contestProbId") ?? "").replace(/\D/g, "")), Number(form.get("pageIndex") ?? 1)), String(url));
    }) as typeof fetch);
    assert.equal(missing.status, "SCAN_INCOMPLETE");
    const foreign = await loadSweaHistoryPreview(first, location, (async (url, init) => {
      if (String(url).includes("userSubmitProblem")) return response(listPage(Number(new URL(String(url)).searchParams.get("pageIndex"))), String(url));
      const form = new URLSearchParams(String(init?.body ?? "")); return response(history(Number((form.get("contestProbId") ?? "").replace(/\D/g, "")), Number(form.get("pageIndex") ?? 1), "OtherUser"), String(url));
    }) as typeof fetch);
    assert.equal(foreign.status, "OWNERSHIP_UNVERIFIED");
  } finally { restore(); }
});
