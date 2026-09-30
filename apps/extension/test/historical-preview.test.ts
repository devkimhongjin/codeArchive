import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { importVisibleJungolHistory, isJungolHistorySenderUrl, loadJungolHistoryPreview, previewJungolHistory, verifyJungolHistoryDetail } from "../src/historicalJungol";
import { authenticatedSweaUserId, previewSweaHistory } from "../src/historicalSwea";
import { previewProgrammersHistory } from "../src/historicalProgrammers";
import { createAdapter } from "../src/adapters";
import { startCapture } from "../src/content";

const locationFor = (href: string): Location => new URL(href) as unknown as Location;

function jungolPage(options: { own?: boolean; account?: string; verdict?: string; detailAccount?: string; denied?: boolean } = {}): Document {
  const { document } = parseHTML(`<html><body>
    ${options.denied ? "APIError(403): 권한이 없어요" : ""}
    <button role="switch" aria-checked="${options.own === false ? "false" : "true"}">내 제출</button>
    <button aria-label="@${options.account ?? "mine"} 필터 해제"></button>
    <table><tr><th>번호</th></tr><tr>
      <td data-col="번호">12345</td>
      <td data-col="문제"><a href="/problem/1520">계단 오르기 #1520</a></td>
      <td data-col="결과">${options.verdict ?? "정답 <span>100점</span>"}</td>
      <td data-col="시간">25ms</td><td data-col="메모리">33.0MB</td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?account=${options.detailAccount ?? "mine"}&amp;sid=12345">Java 8</a></td>
    </tr></table></body></html>`);
  return document;
}

function currentJungolAccountPage(resultSid = '13771703', languageSid = resultSid): Document {
  return parseHTML(`<html><body><a class="crumb" href="/account/152511">@mine</a>
    <a href="/account/152511/edit">정보 수정</a>
    <a class="active" href="/account/152511/submission">제출 현황</a>
    <table><tr><td data-col="번호"><div class="sl-id-cell"></div></td>
      <td data-col="제출자"><a href="/account/152511">mine</a></td>
      <td data-col="문제"><span class="sl-problem-cell"><span class="chip"><span>회장뽑기 <span class="up">#1544</span></span></span></span></td>
      <td data-col="결과">정답 <span>100점</span><a class="sl-card-link" href="?sid=${resultSid}"></a></td>
      <td data-col="시간">254<span>ms</span><span>·</span></td>
      <td data-col="메모리">33.0<span>MB</span><span>·</span></td>
      <td data-col="코드 길이">5<span>B</span></td>
      <td data-col="언어"><a href="?sid=${languageSid}">Java 15</a></td></tr></table></body></html>`).document;
}

test('Jungol current account layout reads a corroborated submission link and text-only problem identity', () => {
  const location = locationFor('https://jungol.co.kr/account/152511/submission');
  const result = previewJungolHistory(currentJungolAccountPage(), location);
  assert.equal(result.status, 'READY');
  if (result.status === 'READY') {
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0], {
      submissionId: '13771703', problemNumber: '1544', title: '회장뽑기', language: 'Java 15',
      detailUrl: 'https://jungol.co.kr/account/152511/submission?sid=13771703',
      codeByteLength: 5, executionTime: 254, memoryValue: 33
    });
  }
  const mismatch = previewJungolHistory(currentJungolAccountPage('13771703', '999'), location);
  assert.equal(mismatch.status, 'READY');
  if (mismatch.status === 'READY') assert.equal(mismatch.candidates.length, 0);
  const groupedChild = currentJungolAccountPage();
  groupedChild.querySelector('td[data-col="번호"]')!.textContent = '2';
  const childPreview = previewJungolHistory(groupedChild, location);
  assert.equal(childPreview.status, 'READY');
  if (childPreview.status === 'READY') assert.deepEqual(childPreview.candidates.map(item => item.submissionId), ['13771703']);
  groupedChild.querySelector('td[data-col="번호"]')!.innerHTML = '<span class="sl-id">999</span>';
  const badExplicitId = previewJungolHistory(groupedChild, location);
  if (badExplicitId.status === 'READY') assert.equal(badExplicitId.candidates.length, 0);
});

test('Jungol current account layout verifies source in its same-URL submission dialog', async () => {
  const document = currentJungolAccountPage();
  const location = locationFor('https://jungol.co.kr/account/152511/submission');
  const preview = previewJungolHistory(document, location);
  assert.equal(preview.status, 'READY');
  if (preview.status !== 'READY') return;
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    document.querySelector<HTMLAnchorElement>('td[data-col="언어"] a')!.addEventListener('click', event => {
      event.preventDefault();
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', '제출 상세');
      dialog.innerHTML = '<span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span>' +
        '<a href="/account/152511">mine</a><a href="/problem/1544">회장뽑기 #1544</a>' +
        '<span class="sd-id">#13771703</span><span class="sd-meta-item"><div role="button"><span class="time">어제</span></div></span>' +
        '<code class="hljs">hello</code><button>닫기</button>';
      dialog.querySelector<HTMLElement>('[role="button"]')!.addEventListener('click', () => {
        const paper = document.createElement('div');
        paper.className = 'paper';
        paper.innerHTML = '<div class="content">2026. 9. 29. 오후 2:21:03</div>';
        dialog.querySelector<HTMLElement>('[role="button"]')!.append(paper);
      });
      dialog.querySelector('button')!.addEventListener('click', () => dialog.remove());
      document.body.append(dialog);
    });
    const captures: unknown[] = [];
    const imported = await importVisibleJungolHistory(document, location, preview.candidates, async capture => {
      captures.push(capture);
      return { ok: true, created: true };
    });
    assert.deepEqual(imported, { saved: 1, duplicate: 0, skipped: 0 });
    assert.equal(captures.length, 1);
  } finally { globalThis.MutationObserver = previousObserver; }
});

test('Jungol current account layout traverses later pages and expands ID-less groups', async () => {
  const document = currentJungolAccountPage();
  const first = document.querySelector<HTMLTableRowElement>('table tr')!;
  const table = document.querySelector('table')!;
  const toggle = document.createElement('button');
  toggle.className = 'sl-group-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span class="sl-group-count">+1</span>';
  first.querySelector('td[data-col="번호"]')!.append(toggle);
  toggle.addEventListener('click', () => {
    const child = first.cloneNode(true) as HTMLTableRowElement;
    child.classList.add('gr');
    child.querySelector('.sl-group-toggle')?.remove();
    child.querySelector('td[data-col="결과"] a')!.setAttribute('href', '?sid=13771704');
    child.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?sid=13771704');
    first.after(child);
    toggle.setAttribute('aria-expanded', 'true');
  });
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  document.body.append(more);
  more.addEventListener('click', () => {
    const older = first.cloneNode(true) as HTMLTableRowElement;
    older.querySelector('.sl-group-toggle')?.remove();
    older.querySelector('td[data-col="결과"] a')!.setAttribute('href', '?sid=13771702');
    older.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?sid=13771702');
    table.append(older);
    more.remove();
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, locationFor('https://jungol.co.kr/account/152511/submission'));
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') {
      assert.deepEqual(result.candidates.map(candidate => candidate.submissionId), ['13771703', '13771704', '13771702']);
      assert.equal(result.truncated, false);
      assert.equal(result.paginationClicks, 1);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol only previews accepted rows with an exact own-account filter and matching detail identity", () => {
  const url = locationFor("https://jungol.co.kr/submission?account=mine");
  const ready = previewJungolHistory(jungolPage(), url);
  assert.equal(ready.status, "READY");
  if (ready.status !== "READY") return;
  assert.deepEqual(ready.candidates.map(candidate => [candidate.submissionId, candidate.problemNumber, candidate.title]),
    [["12345", "1520", "계단 오르기"]]);
  assert.equal(previewJungolHistory(jungolPage({ own: false }), url).status, "LOGIN_REQUIRED");
  assert.equal(previewJungolHistory(jungolPage({ denied: true }), url).status, "ACCESS_DENIED");
  assert.equal(previewJungolHistory(jungolPage({ account: "other" }), url).status, "OWNERSHIP_UNVERIFIED");
  const wrongOwner = previewJungolHistory(jungolPage({ detailAccount: "other" }), url);
  assert.equal(wrongOwner.status, "READY");
  if (wrongOwner.status === "READY") assert.equal(wrongOwner.candidates.length, 0);
  const failed = previewJungolHistory(jungolPage({ verdict: "오답 0점" }), url);
  if (failed.status === "READY") assert.equal(failed.candidates.length, 0);
});

test("Jungol accepts exact owner, submission, problem, verdict, code bytes and submission time only", () => {
  const listUrl = locationFor("https://jungol.co.kr/submission?account=mine");
  const preview = previewJungolHistory(jungolPage(), listUrl);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  const candidate = preview.candidates[0]!;
  const detailUrl = locationFor("https://jungol.co.kr/submission?account=mine&sid=12345");
  const detail = (values: { owner?: string; id?: string; problem?: string; score?: string; verdict?: string; code?: string; time?: string } = {}) =>
    parseHTML(`<html><body><button role="switch" aria-checked="true">내 제출</button>
    <button aria-label="@mine 필터 해제"></button><div role="dialog" aria-label="제출 상세">
      <span class="sd-heading-score">${values.score ?? "100점"}</span>
      <span class="sd-heading-status">${values.verdict ?? "정답"}</span>
      <a href="/account/12">${values.owner ?? "mine"}</a>
      <a href="/problem/${values.problem ?? "1520"}">계단 오르기 #${values.problem ?? "1520"}</a>
      <span class="sd-id">#${values.id ?? "12345"}</span>
      <span class="sd-meta-item"><div><span class="time">하루 전</span><div class="paper"><div class="content">${values.time ?? "2026. 9. 28. 오후 2:21:03"}</div></div></div></span>
      <code class="hljs">${values.code ?? "hello"}</code>
    </div></body></html>`).document;
  const valid = verifyJungolHistoryDetail(detail(), detailUrl, candidate);
  assert.equal(valid?.sourceCode, "hello");
  assert.equal(valid?.solvedAt, "2026-09-28T05:21:03.000Z");
  assert.equal(verifyJungolHistoryDetail(detail({ owner: "other" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail({ id: "999" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail({ problem: "999" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail({ verdict: "오답" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail({ code: "hell" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail({ time: "어제" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail({ time: "2026. 2. 30. 오후 2:21:03" }), detailUrl, candidate), null);
  assert.equal(verifyJungolHistoryDetail(detail(), locationFor("https://jungol.co.kr/submission?account=mine&sid=other"), candidate), null);
  const signedOut = detail();
  signedOut.querySelector('[role="switch"]')?.setAttribute('aria-checked', 'false');
  assert.equal(verifyJungolHistoryDetail(signedOut, detailUrl, candidate), null);
  const switchedAccount = detail();
  switchedAccount.querySelector('button[aria-label]')?.setAttribute('aria-label', '@other 필터 해제');
  assert.equal(verifyJungolHistoryDetail(switchedAccount, detailUrl, candidate), null);
});

test("Jungol dashboard-triggered batch verifies a detail before a local-only store", async () => {
  const document = jungolPage();
  const location = locationFor("https://jungol.co.kr/submission?account=mine");
  const preview = previewJungolHistory(document, location);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const link = document.querySelector<HTMLAnchorElement>('td[data-col="언어"] a')!;
    link.addEventListener('click', event => {
      event.preventDefault();
      (location as unknown as URL).search = '?account=mine&sid=12345';
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', '제출 상세');
      dialog.innerHTML = '<span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span><a href="/account/12">mine</a><a href="/problem/1520">계단 오르기 #1520</a><span class="sd-id">#12345</span><span class="sd-meta-item"><div role="button"><span class="time">어제</span></div></span><code class="hljs">hello</code><button>닫기</button>';
      dialog.querySelector<HTMLElement>('[role="button"]')!.addEventListener('click', () => {
        const paper = document.createElement('div');
        paper.className = 'paper';
        paper.innerHTML = '<div class="content">2026. 9. 28. 오후 2:21:03</div>';
        dialog.querySelector<HTMLElement>('[role="button"]')!.append(paper);
      });
      dialog.querySelector('button')!.addEventListener('click', () => {
        dialog.remove();
        (location as unknown as URL).search = '?account=mine';
      });
      document.body.append(dialog);
    });
    const stored: unknown[] = [];
    const result = await importVisibleJungolHistory(document, location, preview.candidates, async capture => {
      stored.push(capture);
      return { ok: true, created: true };
    });
    assert.deepEqual(result, { saved: 1, duplicate: 0, skipped: 0 });
    assert.equal(stored.length, 1);
    assert.equal((stored[0] as { historicalImport?: boolean }).historicalImport, true);
    assert.equal((stored[0] as { historicalSubmissionId?: string }).historicalSubmissionId, '12345');
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol history can be read after same-document navigation without site-injected controls or loss of live capture", async () => {
  const { document } = parseHTML('<html><body><h1><span>계단 오르기</span></h1></body></html>');
  const location = locationFor("https://jungol.co.kr/problem/1520");
  const previousElement = globalThis.Element;
  const previousObserver = globalThis.MutationObserver;
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  try {
    const adapter = createAdapter(document, location);
    assert.ok(adapter);
    startCapture(adapter, document, async () => ({ ok: true }));
    assert.equal(document.getElementById("codearchive-history-preview"), null);
    const url = location as unknown as URL;
    url.pathname = "/submission";
    url.search = "?account=mine";
    document.body.innerHTML = jungolPage().body.innerHTML;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.getElementById("codearchive-history-preview"), null);
    assert.equal(previewJungolHistory(document, location).status, "READY");
    url.pathname = "/problem/1520";
    url.search = "";
    document.body.innerHTML = '<h1><span>계단 오르기</span></h1>';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(adapter.detectProblem()?.problemNumber, "1520");
  } finally {
    Object.assign(globalThis, { Element: previousElement, MutationObserver: previousObserver });
  }
});

test("Jungol own account page expands grouped accepted submissions with no preview count cap", async () => {
  const row = (id: number, problem = 2000, verdict = "정답 <span>100점</span>") => `<tr><td data-col="번호"><span class="sl-id">${id}</span></td>
    <td data-col="제출자"><a href="/account/152511">mine</a></td>
    <td data-col="문제"><a href="/problem/${problem}">동전교환 #${problem}</a></td>
    <td data-col="결과">${verdict}</td><td data-col="시간">25ms</td><td data-col="메모리">33.0MB</td>
    <td data-col="코드 길이">5B</td><td data-col="언어"><a href="?sid=${id}">Java 8</a></td></tr>`;
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/152511">@mine</a>
    <a href="/account/152511/edit">정보 수정</a><a class="active" href="/account/152511/submission">제출 현황</a>
    <table>${Array.from({ length: 60 }, (_, index) => row(1000 + index)).join("")}
    <tr><td data-col="번호"><span class="sl-id">2000</span><button class="sl-group-toggle" aria-expanded="false"><span class="sl-group-count">+3</span></button></td></tr></table></body></html>`);
  const toggle = document.querySelector<HTMLButtonElement>("button.sl-group-toggle")!;
  toggle.addEventListener("click", () => {
    setTimeout(() => {
      toggle.setAttribute("aria-expanded", "true");
      toggle.closest("tr")!.after(...[row(2001), row(2002), row(2003, 2001, "오답 0점")].map(html => {
        const wrapper = document.createElement("tbody"); wrapper.innerHTML = html;
        const child = wrapper.querySelector("tr")!; child.classList.add('gr'); return child;
      }));
    }, 0);
  });
  const url = locationFor("https://jungol.co.kr/account/152511/submission");
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  const result = await loadJungolHistoryPreview(document, url, () => undefined, 1)
    .finally(() => { globalThis.MutationObserver = previousObserver; });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.candidates.length, 62);
  assert.equal(result.skipped, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.candidates.some(candidate => candidate.submissionId === "2002"));
  assert.equal(previewJungolHistory(document, locationFor("https://jungol.co.kr/account/999/submission")).status, "OWNERSHIP_UNVERIFIED");
});

test("Jungol preview loads all older pages before counting accepted submissions", async () => {
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/152511">@mine</a>
    <a href="/account/152511/edit">정보 수정</a><a class="active" href="/account/152511/submission">제출 현황</a>
    <table><tr><td data-col="번호"><span class="sl-id">1001</span></td><td data-col="제출자"><a href="/account/152511">mine</a></td>
      <td data-col="문제"><a href="/problem/2000">동전교환 #2000</a></td><td data-col="결과">정답 <span>100점</span></td>
      <td data-col="시간">25ms</td><td data-col="메모리">33.0MB</td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?sid=1001">Java 8</a></td></tr></table>
    <button id="more">더 불러오기</button></body></html>`);
  const more = document.querySelector<HTMLButtonElement>("#more")!;
  let clicks = 0;
  more.addEventListener("click", () => {
    more.disabled = true;
    setTimeout(() => {
      clicks += 1;
      const row = document.querySelector("table tr")!.cloneNode(true) as HTMLTableRowElement;
      row.querySelector(".sl-id")!.textContent = String(1001 + clicks);
      row.querySelector('td[data-col="언어"] a')!.setAttribute("href", `?sid=${1001 + clicks}`);
      if (clicks === 1) {
        const toggle = document.createElement("button");
        toggle.className = "sl-group-toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = '<span class="sl-group-count">+1</span>';
        toggle.addEventListener("click", () => setTimeout(() => {
          toggle.setAttribute("aria-expanded", "true");
          const child = row.cloneNode(true) as HTMLTableRowElement;
          child.classList.add('gr');
          child.querySelector(".sl-group-toggle")?.remove();
          child.querySelector(".sl-id")!.textContent = "1004";
          child.querySelector('td[data-col="언어"] a')!.setAttribute("href", "?sid=1004");
          row.after(child);
        }, 1_700));
        row.querySelector('td[data-col="번호"]')!.append(toggle);
      }
      document.querySelector("table")!.append(row);
      more.disabled = false;
      if (clicks === 2) more.remove();
    }, 5);
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  const result = await loadJungolHistoryPreview(document, locationFor("https://jungol.co.kr/account/152511/submission"))
    .finally(() => { globalThis.MutationObserver = previousObserver; });
  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.candidates.length, 4);
    assert.equal(result.truncated, false);
    assert.equal(result.scanProtocol, 3);
    assert.equal(result.paginationClicks, 2);
  }
  assert.equal(clicks, 2);
});

test("Jungol preview waits for a delayed load-more control after the first page renders", async () => {
  const document = jungolPage();
  const location = locationFor("https://jungol.co.kr/submission?account=mine");
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    setTimeout(() => {
      const more = document.createElement("button");
      more.textContent = "더 불러오기";
      more.addEventListener("click", () => {
        const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest("tr")!.cloneNode(true) as HTMLTableRowElement;
        row.querySelector('td[data-col="번호"]')!.textContent = "12346";
        row.querySelector('td[data-col="언어"] a')!.setAttribute("href", "?account=mine&sid=12346");
        document.querySelector("table")!.append(row);
        more.remove();
      });
      document.querySelector("table")!.after(more);
    }, 50);
    const result = await loadJungolHistoryPreview(document, location);
    assert.equal(result.status, "READY");
    if (result.status === "READY") {
      assert.deepEqual(result.candidates.map(candidate => candidate.submissionId), ["12345", "12346"]);
      assert.equal(result.truncated, false);
      assert.equal(result.scanProtocol, 3);
      assert.equal(result.paginationClicks, 1);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol waits for grouped submissions that hydrate after the final cursor disappears", async () => {
  const document = jungolPage();
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  document.querySelector('table')!.after(more);
  more.addEventListener('click', () => {
    const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.innerHTML = '<span class="sl-id">12346</span>';
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    document.querySelector('table')!.append(row);
    more.remove();
    setTimeout(() => {
      const toggle = document.createElement('button');
      toggle.className = 'sl-group-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span class="sl-group-count">+1</span>';
      toggle.addEventListener('click', () => {
        toggle.setAttribute('aria-expanded', 'true');
        const child = row.cloneNode(true) as HTMLTableRowElement;
        child.classList.add('gr');
        child.querySelector('.sl-group-toggle')?.remove();
        child.querySelector('.sl-id')!.textContent = '12347';
        child.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12347');
        row.after(child);
      });
      row.querySelector('td[data-col="번호"]')!.append(toggle);
    }, 3_500);
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, locationFor('https://jungol.co.kr/submission?account=mine'));
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') {
      assert.deepEqual(result.candidates.map(candidate => candidate.submissionId), ['12345', '12346', '12347']);
      assert.equal(result.truncated, false);
      assert.equal(result.paginationClicks, 1);
    }
    const again = await loadJungolHistoryPreview(document, locationFor('https://jungol.co.kr/submission?account=mine'));
    assert.equal(again.status, 'READY');
    if (again.status === 'READY') {
      assert.deepEqual(again.candidates.map(candidate => candidate.submissionId), ['12345', '12346', '12347']);
      assert.equal(again.truncated, false);
      assert.equal(again.paginationClicks, 1);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol keeps scanning when pagination appears after the first settle window", async () => {
  const document = jungolPage();
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  const lateButton = setTimeout(() => {
    const more = document.createElement("button");
    more.textContent = "더 불러오기";
    more.addEventListener("click", () => {
      const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest("tr")!.cloneNode(true) as HTMLTableRowElement;
      row.querySelector('td[data-col="번호"]')!.textContent = "12346";
      row.querySelector('td[data-col="언어"] a')!.setAttribute("href", "?account=mine&sid=12346");
      document.querySelector("table")!.append(row);
      more.remove();
    });
    document.querySelector("table")!.after(more);
  }, 3_500);
  try {
    const result = await loadJungolHistoryPreview(document, locationFor("https://jungol.co.kr/submission?account=mine"));
    assert.equal(result.status, "READY");
    if (result.status === "READY") {
      assert.equal(result.candidates.length, 2);
      assert.equal(result.truncated, false);
    }
  } finally {
    clearTimeout(lateButton);
    globalThis.MutationObserver = previousObserver;
  }
});

test("Jungol never treats a version-pinned short first page as proof of completion", async () => {
  const document = jungolPage();
  const table = document.querySelector('table')!;
  const first = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  for (let index = 1; index < 13; index++) {
    const row = first.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.textContent = String(12345 + index);
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', `?account=mine&sid=${12345 + index}`);
    table.append(row);
  }
  const footer = document.createElement('footer');
  footer.textContent = '© 2010-2026 JUNGOL v8.0.0';
  document.body.append(footer);
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, locationFor('https://jungol.co.kr/submission?account=mine'), () => undefined, 1);
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') {
      assert.equal(result.candidates.length, 13);
      assert.equal(result.truncated, true);
      assert.equal(result.scanProtocol, 3);
      assert.equal(result.paginationClicks, 0);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol does not mistake a full first page for a single-page account", async () => {
  const document = jungolPage();
  const footer = document.createElement('footer');
  footer.textContent = 'JUNGOL v8.0.0';
  document.body.append(footer);
  const toggle = document.createElement('button');
  toggle.className = 'sl-group-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span class="sl-group-count">+29</span>';
  document.querySelector('td[data-col="번호"]')!.append(toggle);
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, locationFor('https://jungol.co.kr/submission?account=mine'), () => undefined, 1);
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') assert.equal(result.truncated, true);
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol recognizes the site's removed cursor control after a loaded final page", async () => {
  const document = jungolPage();
  const table = document.querySelector('table')!;
  const first = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  const second = first.cloneNode(true) as HTMLTableRowElement;
  second.querySelector('td[data-col="번호"]')!.textContent = '12346';
  second.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
  table.append(second);
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  table.after(more);
  more.addEventListener('click', () => {
    const last = first.cloneNode(true) as HTMLTableRowElement;
    last.querySelector('td[data-col="번호"]')!.textContent = '12347';
    last.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12347');
    table.append(last);
    more.remove();
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, locationFor('https://jungol.co.kr/submission?account=mine'));
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') {
      assert.deepEqual(result.candidates.map(candidate => candidate.submissionId), ['12345', '12346', '12347']);
      assert.equal(result.truncated, false);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol retry cannot complete a page whose cursor vanished before its rows arrived", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  document.querySelector('table')!.after(more);
  more.addEventListener('click', () => more.remove());
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
      assert.equal(result.status, 'READY');
      if (result.status === 'READY') assert.equal(result.truncated, true);
      if (attempt === 0) {
        // A group can expand independently while the cursor request is unresolved.
        const parent = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
        const toggle = document.createElement('button');
        toggle.className = 'sl-group-toggle';
        toggle.setAttribute('aria-expanded', 'true');
        parent.querySelector('td[data-col="번호"]')!.append(toggle);
        const child = parent.cloneNode(true) as HTMLTableRowElement;
        child.classList.add('gr');
        child.querySelector('.sl-group-toggle')!.remove();
        child.querySelector('td[data-col="번호"]')!.textContent = '12347';
        child.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12347');
        parent.after(child);
      }
    }
    const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.textContent = '12346';
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    document.querySelector('table')!.append(row);
    const resolved = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
    assert.equal(resolved.status, 'READY');
    if (resolved.status === 'READY') {
      assert.equal(resolved.truncated, false);
      assert.deepEqual(resolved.candidates.map(item => item.submissionId), ['12345', '12347', '12346']);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol retry waits for all children of a group that already appears expanded", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const parent = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  document.querySelector('table')!.after(more);
  const toggle = document.createElement('button');
  toggle.className = 'sl-group-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span class="sl-group-count">+1</span>';
  more.addEventListener('click', () => {
    const loaded = parent.cloneNode(true) as HTMLTableRowElement;
    loaded.querySelector('td[data-col="번호"]')!.innerHTML = '<span class="sl-id">12346</span>';
    loaded.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    loaded.querySelector('td[data-col="번호"]')!.append(toggle);
    document.querySelector('table')!.append(loaded);
    more.remove();
  });
  toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', 'true'));
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
      assert.equal(result.status, 'READY');
      if (result.status === 'READY') assert.equal(result.truncated, true);
      if (attempt === 0) {
        // A late page row must not satisfy this group's missing child.
        const unrelated = parent.cloneNode(true) as HTMLTableRowElement;
        unrelated.querySelector('td[data-col="번호"]')!.textContent = '12348';
        unrelated.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12348');
        document.querySelector('table')!.append(unrelated);
      }
    }
    const child = parent.cloneNode(true) as HTMLTableRowElement;
    child.classList.add('gr');
    child.querySelector('td[data-col="번호"]')!.textContent = '12347';
    child.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12347');
    toggle.closest('tr')!.after(child);
    const resolved = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
    assert.equal(resolved.status, 'READY');
    if (resolved.status === 'READY') {
      assert.equal(resolved.truncated, false);
      assert.deepEqual(resolved.candidates.map(item => item.submissionId), ['12345', '12346', '12347', '12348']);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol does not reuse a finished page count after the same URL rerenders its table", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const table = document.querySelector('table')!;
  const first = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  table.after(more);
  more.addEventListener('click', () => {
    const second = first.cloneNode(true) as HTMLTableRowElement;
    second.querySelector('td[data-col="번호"]')!.textContent = '12346';
    second.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    table.append(second);
    more.remove();
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const complete = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
    assert.equal(complete.status, 'READY');
    if (complete.status === 'READY') assert.equal(complete.truncated, false);
    table.querySelectorAll('tr')[2]?.remove();
    const shortened = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
    assert.equal(shortened.status, 'READY');
    if (shortened.status === 'READY') assert.equal(shortened.truncated, true);
    const replacement = first.cloneNode(true) as HTMLTableRowElement;
    replacement.querySelector('td[data-col="번호"]')!.textContent = '12348';
    replacement.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12348');
    table.append(replacement);
    const replaced = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
    assert.equal(replaced.status, 'READY');
    if (replaced.status === 'READY') assert.equal(replaced.truncated, true);
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol does not count a cursor page when its previous rows are replaced mid-click", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const table = document.querySelector('table')!;
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  table.after(more);
  more.addEventListener('click', () => {
    const row = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
    row.querySelector('td[data-col="번호"]')!.textContent = '12346';
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    more.remove();
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5);
      assert.equal(result.status, 'READY');
      if (result.status === 'READY') assert.equal(result.truncated, true);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol waits for the next cursor after the previous page rows arrive", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const table = document.querySelector('table')!;
  const first = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  const addRow = (id: string) => {
    const row = first.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.textContent = id;
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', `?account=mine&sid=${id}`);
    table.append(row);
  };
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  table.after(more);
  more.addEventListener('click', () => {
    addRow('12346');
    more.remove();
    setTimeout(() => {
      const next = document.createElement('button');
      next.textContent = '더 불러오기';
      next.addEventListener('click', () => { addRow('12347'); next.remove(); });
      table.after(next);
    }, 12);
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, location, () => undefined, 4, 5);
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') {
      assert.equal(result.truncated, false);
      assert.equal(result.paginationClicks, 2);
      assert.deepEqual(result.candidates.map(item => item.submissionId), ['12345', '12346', '12347']);
    }
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol detects rows removed while waiting for the next cursor", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const table = document.querySelector('table')!;
  const first = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  table.after(more);
  more.addEventListener('click', () => {
    const second = first.cloneNode(true) as HTMLTableRowElement;
    second.querySelector('td[data-col="번호"]')!.textContent = '12346';
    second.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    table.append(second);
    more.remove();
    setTimeout(() => second.remove(), 12);
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, location, () => undefined, 4, 5);
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') assert.equal(result.truncated, true);
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol stops a superseded scan before it can click the replacement listing", async () => {
  const document = jungolPage();
  const location = locationFor('https://jungol.co.kr/submission?account=mine');
  const table = document.querySelector('table')!;
  const first = table.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!;
  const more = document.createElement('button');
  more.textContent = '더 불러오기';
  table.after(more);
  let active = true;
  let clicks = 0;
  more.addEventListener('click', () => {
    clicks++;
    if (clicks === 1) {
      const replacement = first.cloneNode(true) as HTMLTableRowElement;
      replacement.querySelector('td[data-col="번호"]')!.textContent = '12346';
      replacement.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
      table.append(replacement);
      active = false;
    }
  });
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const result = await loadJungolHistoryPreview(document, location, () => undefined, 1, 5, () => active);
    assert.equal(result.status, 'OWNERSHIP_UNVERIFIED');
    assert.equal(clicks, 1);
  } finally { globalThis.MutationObserver = previousObserver; }
});

test("Jungol accepts a verified correct row even when a performance metric is unavailable", () => {
  const document = jungolPage();
  document.querySelector('td[data-col="메모리"]')!.textContent = '-';
  const result = previewJungolHistory(document, locationFor('https://jungol.co.kr/submission?account=mine'));
  assert.equal(result.status, 'READY');
  if (result.status === 'READY') {
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.memoryValue, undefined);
    assert.equal(result.candidates[0]?.executionTime, 25);
  }
});

test("Jungol account detail accepts only exact owner and submission even when URL keeps the listing path", () => {
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/152511">@mine</a><a href="/account/152511/edit">정보 수정</a>
    <a class="active" href="/account/152511/submission">제출 현황</a>
    <div role="dialog" aria-label="제출 상세"><span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span>
    <a href="/account/152511">mine</a><a href="/problem/2000">동전교환 #2000</a><span class="sd-id">#2001</span>
    <span class="sd-meta-item"><div><span class="time">어제</span><div class="paper"><div class="content">2026. 9. 28. 오후 2:21:03</div></div></div></span>
    <code class="hljs">hello</code></div></body></html>`);
  const candidate = { submissionId: "2001", problemNumber: "2000", title: "동전교환", language: "Java 8",
    detailUrl: "https://jungol.co.kr/account/152511/submission?sid=2001", codeByteLength: 5, executionTime: 25, memoryValue: 33 };
  const url = locationFor("https://jungol.co.kr/account/152511/submission");
  assert.equal(verifyJungolHistoryDetail(document, url, candidate)?.sourceCode, "hello");
  document.querySelector(".sd-id")!.textContent = "#9999";
  assert.equal(verifyJungolHistoryDetail(document, url, candidate), null);
});

test("historical storage sender accepts the verified account route but rejects unrelated accounts and paths", () => {
  assert.equal(isJungolHistorySenderUrl(new URL("https://jungol.co.kr/account/152511/submission")), true);
  assert.equal(isJungolHistorySenderUrl(new URL("https://jungol.co.kr/submission?account=mine")), true);
  assert.equal(isJungolHistorySenderUrl(new URL("https://jungol.co.kr/account/152511/submission?account=other")), false);
  assert.equal(isJungolHistorySenderUrl(new URL("https://jungol.co.kr/account/152511")), false);
  assert.equal(isJungolHistorySenderUrl(new URL("https://evil.example/account/152511/submission")), false);
});

test("Jungol account listing imports a verified detail without requiring a sid URL transition", async () => {
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/152511">@mine</a>
    <a href="/account/152511/edit">정보 수정</a><a class="active" href="/account/152511/submission">제출 현황</a>
    <table><tr><td data-col="번호"><span class="sl-id">2001</span></td>
      <td data-col="제출자"><a href="/account/152511">mine</a></td>
      <td data-col="문제"><a href="/problem/2000">동전교환 #2000</a></td>
      <td data-col="결과">정답 <span>100점</span></td><td data-col="시간">25ms</td>
      <td data-col="메모리">33.0MB</td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?sid=2001">Java 8</a></td></tr></table></body></html>`);
  const location = locationFor("https://jungol.co.kr/account/152511/submission");
  const preview = previewJungolHistory(document, location);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    document.querySelector('td[data-col="언어"] a')!.addEventListener("click", event => {
      event.preventDefault();
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "제출 상세");
      dialog.innerHTML = `<span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span>
        <a href="/account/152511">mine</a><a href="/problem/2000">동전교환 #2000</a><span class="sd-id">#2001</span>
        <span class="sd-meta-item"><div role="button"><span class="time">어제</span></div></span>
        <code class="hljs">hello</code><button>닫기</button>`;
      const timeTrigger = dialog.querySelector<HTMLElement>('[role="button"]')!;
      timeTrigger.addEventListener("click", () => {
        const paper = timeTrigger.querySelector(".paper");
        if (paper) { paper.remove(); timeTrigger.setAttribute("aria-expanded", "false"); return; }
        const next = document.createElement("div"); next.className = "paper";
        next.innerHTML = '<div class="content">2026. 9. 28. 오후 2:21:03</div>';
        timeTrigger.append(next);
        timeTrigger.setAttribute("aria-expanded", "true");
      });
      dialog.querySelector("button")!.addEventListener("click", () => {
        if (timeTrigger.getAttribute("aria-expanded") === "true") timeTrigger.click();
        else dialog.remove();
      });
      document.body.append(dialog);
    });
    const stored: unknown[] = [];
    const result = await importVisibleJungolHistory(document, location, preview.candidates, async capture => {
      stored.push(capture); return { ok: true, created: true };
    });
    assert.deepEqual(result, { saved: 1, duplicate: 0, skipped: 0 });
    assert.equal(stored.length, 1);
    assert.equal(document.querySelector('[role="dialog"][aria-label="제출 상세"]'), null);
  } finally { globalThis.MutationObserver = previousObserver; }
});

function sweaPage(options: { signedIn?: string; profile?: string; ownLink?: string; unfinished?: boolean } = {}): Document {
  const userId = options.ownLink ?? "user123";
  const { document } = parseHTML(`<html><body>
    <a class="my-login"><span class="name">${options.signedIn ?? "me"}</span></a>
    <div class="mypage_wrap"><div class="my_label"><span class="nick">${options.profile ?? "me"}</span></div></div>
    <a onclick="javascript:fnMoveToMenu('CODE','${userId}');">Code</a>
    <div class="widget-box-sub"><span class="week_num">9999.</span><span class="week_text"><a onclick="javascript:fn_move_prob('OUTSIDE','N','CODE','','OUTSIDE','');">다른 영역</a></span></div>
    <div id="submitProb"><div class="widget-box-sub">
      <span class="week_num">4796.</span><span class="week_text"><a onclick="javascript:fn_move_prob('AWS2h6AKBCoDFAVT','N','CODE','','AWS2h6AKBCoDFAVT','');">의석이의 우뚝 선 산</a></span>
      ${options.unfinished ? "<span>풀이중</span>" : ""}
    </div></div></body></html>`);
  return document;
}

test("SWEA previews only the signed-in owner's problem candidates and never treats them as submissions", () => {
  const url = locationFor("https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do?userId=user123");
  const ready = previewSweaHistory(sweaPage(), url, "user123");
  assert.equal(ready.status, "READY");
  if (ready.status === "READY") assert.deepEqual(ready.candidates.map(candidate => candidate.problemNumber), ["4796"]);
  assert.equal(previewSweaHistory(sweaPage(), url).status, "OWNERSHIP_UNVERIFIED");
  assert.equal(previewSweaHistory(sweaPage(), url, "otherUser").status, "OWNERSHIP_UNVERIFIED");
  assert.equal(previewSweaHistory(sweaPage({ signedIn: "" }), url).status, "LOGIN_REQUIRED");
  assert.equal(previewSweaHistory(sweaPage({ profile: "other" }), url, "user123").status, "OWNERSHIP_UNVERIFIED");
  assert.equal(previewSweaHistory(sweaPage({ ownLink: "anotherUser" }), url, "user123").status, "OWNERSHIP_UNVERIFIED");
  const unfinished = previewSweaHistory(sweaPage({ unfinished: true }), url, "user123");
  if (unfinished.status === "READY") assert.equal(unfinished.candidates.length, 0);
});

test("SWEA authenticated profile identifies the signed-in user only from the exact Code menu", () => {
  const { document } = parseHTML('<a onclick="javascript:fnMoveToMenu(\'CODE\',\'user123\');">Code</a>');
  assert.equal(authenticatedSweaUserId(document), "user123");
  const other = parseHTML('<a onclick="javascript:fnMoveToMenu(\'HOME\',\'user123\');">Code</a>');
  assert.equal(authenticatedSweaUserId(other.document), null);
});

test("SWEA recognizes query-less own submission list and real javascript href menu", () => {
  const page = sweaPage();
  const menu = [...page.querySelectorAll("a")].find(anchor => anchor.textContent === "Code")!;
  menu.setAttribute("href", menu.getAttribute("onclick")!);
  menu.removeAttribute("onclick");
  assert.equal(authenticatedSweaUserId(page), "user123");
  const result = previewSweaHistory(page, locationFor("https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do"), "user123");
  assert.equal(result.status, "READY");
  if (result.status === "READY") assert.equal(result.candidates.length, 1);
  assert.equal(previewSweaHistory(page, locationFor("https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do?userId=other"), "user123").status, "OWNERSHIP_UNVERIFIED");
});

test("Programmers previews signed-in solved list only, without treating it as source evidence", () => {
  const { document } = parseHTML(`<html><body><a href="https://programmers.co.kr/users/profile">마이페이지</a><button>로그아웃</button>
    <table><tbody><tr><td class="status solved"><span data-tip="2026-09-21 16:43:39"></span></td>
      <td class="title"><a href="/learn/courses/30/lessons/42861">섬 연결하기</a></td></tr>
      <tr><td class="status"><span data-tip="2026-09-21 16:43:39"></span></td>
      <td class="title"><a href="/learn/courses/30/lessons/12345">미해결</a></td></tr></tbody></table>
    <button aria-label="다음 페이지"></button></body></html>`);
  const url = locationFor("https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1");
  const result = previewProgrammersHistory(document, url);
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.candidates.map(candidate => candidate.problemNumber), ["42861"]);
  assert.equal(result.truncated, true);
  assert.equal(previewProgrammersHistory(document, locationFor("https://school.programmers.co.kr/learn/challenges?page=1")).status, "OWNERSHIP_UNVERIFIED");
  document.querySelector("button")!.remove();
  assert.equal(previewProgrammersHistory(document, url).status, "LOGIN_REQUIRED");
});
