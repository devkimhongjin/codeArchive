import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser, parseHTML } from "linkedom";
import { ProgrammersAdapter, isProgrammersAccepted } from "../src/adapters/programmers";
import { SweaAdapter, isSweaAccepted } from "../src/adapters/swea";
import { JungolAdapter } from "../src/adapters/jungol";
import { jungolSignedInHandle, jungolAcceptedIds, parseVerifiedJungolDetail, verifyJungolCapture } from "../src/adapters/jungolVerification";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

test("Jungol only creates a verifiable candidate for a signed-in clicked problem", () => {
  const { document } = parseHTML('<html><body><h1><span>책 정리 로봇</span><span class="limit">2s</span></h1><button id="submit">upload 제출</button><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="4577" data-codearchive-jungol-language="Java 8"></textarea><h5 id="result">정답이에요!</h5><script>window.x={"$/account/my":{data:{id:1,handle:"alice",name:"Alice"}}}</script></body></html>');
  const source = document.querySelector("textarea") as HTMLTextAreaElement;
  source.value = "class Main {}";
  let now = Date.now();
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/4577"), 120_000, () => now);
  assert.equal(adapter.detectProblem()?.problemUrl, "https://jungol.co.kr/problem/4577");
  assert.equal(adapter.isSubmitControl(document.querySelector("#submit")!), true);
  assert.equal(jungolSignedInHandle(document), "alice");
  adapter.beginSubmissionAttempt(new Date(now));
  assert.equal(adapter.detectSubmissionResult(), null, "transient success alone must not count");
  assert.equal(adapter.getSubmissionSnapshot()?.editor, null, "click-time source is not authoritative");
  now += 250;
  source.value = "class Main {}";
  source.dataset.codearchiveJungolRequestAt = String(now);
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  now += 250;
  const detection = adapter.detectSubmissionResult();
  assert.equal(detection?.accepted, true);
  assert.deepEqual(adapter.getSubmissionSnapshot()?.editor, { language: "Java 8", sourceCode: "class Main {}" });
  adapter.consumeSubmissionResult(detection!);
  assert.equal(adapter.detectSubmissionResult(), null);
  assert.equal(new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/4577/submission")).detectProblem(), null);
});

test("Jungol rejects public history and mismatched or unsynced editor source", () => {
  const { document } = parseHTML('<html><body><h1><span>책 정리 로봇</span></h1><table><tr><td>정답 100점</td></tr></table><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="9999" data-codearchive-jungol-language="Java 8"></textarea></body></html>');
  (document.querySelector("textarea") as HTMLTextAreaElement).value = "wrong problem";
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${Date.now()}`);
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/4577"));
  adapter.beginSubmissionAttempt();
  assert.equal(adapter.detectSubmissionResult(), null);
  assert.equal(adapter.getSubmissionSnapshot()?.editor, null);
  assert.equal(jungolSignedInHandle(document), null);
});

test("Jungol verifies exact account/problem/code/verdict/time and authoritative metrics", () => {
  globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;
  const list = '<table><tbody><tr><td><a href="?account=alice&sid=42">42</a></td><td><a href="/problem/4577">책 정리 로봇 #4577</a></td><td>정답 100점</td><td>12ms</td><td>32MB</td><td>10B</td><td>Java 8</td><td>방금 전</td></tr></tbody></table>';
  assert.deepEqual(jungolAcceptedIds(list, "alice", "4577"), [42]);
  assert.deepEqual(jungolAcceptedIds(list, "alice", "9999"), []);
  const capture = { platform: "JUNGOL", problemNumber: "4577", language: "Java 8", sourceCode: "class Main {}" } as Parameters<typeof parseVerifiedJungolDetail>[3];
  const detail = '"$/submission/42":{data:{m_reason:"AC",score:100,m_time:12,m_memory:32768,language:"JAVA",altLanguage:"JAVA8",additional:{account:"alice",time:100000,submissionId:42},source:[{name:"Main.java",source:"class Main {}"}],size:13,submissionId:42,problemId:4577,accountInfo:{handle:"alice"},problemInfo:{title:"책 정리 로봇"}}';
  assert.deepEqual(parseVerifiedJungolDetail(detail, 42, "alice", capture, 99000, 101000), {
    submittedAt: 100000,
    performance: { executionTime: 12, memoryValue: 32768, memoryUnit: "KB", memoryUsage: 32 }
  });
  for (const changed of [detail.replace('score:100', 'score:0'), detail.replace('account:"alice"', 'account:"bob"'), detail.replace('accountInfo:{handle:"alice"', 'accountInfo:{handle:"bob"'), detail.replace('source:"class Main {}"', 'source:"wrong"'), detail.replace('problemId:4577', 'problemId:9999')]) {
    assert.equal(parseVerifiedJungolDetail(changed, 42, "alice", capture, 99000, 101000), null);
  }
  assert.equal(parseVerifiedJungolDetail(detail, 42, "alice", capture, 103000, 104000), null, "old record cannot satisfy a new click");
});

test("Jungol does not persist on a toast or unverifiable page; a matching new detail supplies solvedAt", async () => {
  globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;
  const now = Date.now();
  const capture = { platform: "JUNGOL", problemNumber: "1520", language: "Java 8", sourceCode: "class Main {}", solvedAt: new Date(now).toISOString() } as Parameters<typeof verifyJungolCapture>[0];
  const list = `<table><tbody><tr><td><a href="?account=alice&sid=43">43</a></td><td><a href="/problem/1520">계단 오르기 #1520</a></td><td>정답 100점</td><td>208ms</td><td>33.2MB</td><td>13B</td><td>Java 8</td><td>방금 전</td></tr></tbody></table><script>window.x={list:[{p:1520,id:43,r:"AC",s:100,d:208,m:34040,u:"alice",l:"JAVA",t:${now},c:null}]}</script>`;
  const detail = `"$/submission/43":{data:{m_reason:"AC",score:100,m_time:208,m_memory:34040,language:"JAVA",altLanguage:"JAVA8",additional:{account:"alice",time:${now},submissionId:43},source:[{name:"Main.java",source:"class Main {}"}],size:13,submissionId:43,problemId:1520,accountInfo:{handle:"alice"},problemInfo:{title:"계단 오르기"}}`;
  let calls = 0;
  const request = (async (url: string | URL | Request) => {
    calls += 1;
    return new Response(String(url).includes("sid=43") ? detail : list);
  }) as typeof fetch;
  const verified = await verifyJungolCapture(capture, "alice", now - 1000, request);
  assert.equal(calls, 2);
  assert.equal(verified?.solvedAt, new Date(now).toISOString());
  assert.equal(verified?.memoryUnit, "KB");
  assert.equal(await verifyJungolCapture(capture, "alice", now + 3000, request), null, "historical submission must not satisfy a later click");
  const emptyRequest = (async () => new Response("<h5>정답이에요!</h5>")) as typeof fetch;
  assert.equal(await verifyJungolCapture(capture, "alice", now - 1000, emptyRequest), null);
});

test("SWEA metadata uses the solving heading and fails closed on contest identity conflict", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>1206. View</h3></div><input id="contestProbId" value="current">');
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=other"));
  assert.equal(adapter.detectProblem(), null);
  const valid = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current"));
  assert.deepEqual(valid.detectProblem(), {
    problemNumber: "1206",
    title: "View",
    problemUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=current"
  });
});

test("Programmers accepts only the canonical lesson host/path and hidden #code source", () => {
  const { document } = parseHTML('<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">C++</button></nav><textarea id="code" name="code"></textarea>');
  (document.querySelector("#code") as HTMLTextAreaElement).value = "vector<int> solution() {}";
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42842?language=cpp"));
  assert.deepEqual(adapter.detectProblem(), {
    problemNumber: "42842",
    title: "카펫",
    problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/42842"
  });
  assert.deepEqual(adapter.detectEditor(), { language: "C++", sourceCode: "vector<int> solution() {}" });
  assert.equal(new ProgrammersAdapter(document, locationFor("https://programmers.co.kr/learn/courses/30/lessons/42842")).detectProblem(), null);
});

test("result phrases are exact and never accept surrounding failure prose", () => {
  assert.equal(isSweaAccepted("PASS입니다."), true);
  assert.equal(isSweaAccepted("축하합니다. Pass입니다.제출이 완료되었습니다."), true);
  assert.equal(isSweaAccepted("축하합니다. Pass입니다.\n제출이 완료되었습니다."), true);
  assert.equal(isSweaAccepted("축하합니다. Pass입니다. 컴파일 오류"), false);
  assert.equal(isSweaAccepted("이전 제출은 축하합니다. Pass입니다.제출이 완료되었습니다."), false);
  assert.equal(isSweaAccepted("PASS입니다. 컴파일 오류"), false);
  assert.equal(isSweaAccepted("PASS"), false);
  assert.equal(isProgrammersAccepted("정답입니다!"), true);
  assert.equal(isProgrammersAccepted("실행 결과: 정답입니다!"), false);
});

test("Programmers optional performance fails closed for malformed or ambiguous groups", () => {
  const { document } = parseHTML('<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code">class Solution {}</textarea><div id="modal-dialog" class="modal fade" role="dialog" aria-modal="false"><h4 class="modal-title">정답입니다!</h4></div><div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (1s, 2MB)</td></tr></tbody></table></div>');
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42842"));
  adapter.beginSubmissionAttempt();
  document.querySelector(".console-test-group tbody")!.innerHTML = '<tr><td class="result passed">통과 (1s, 2MB)</td></tr>';
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  assert.equal(adapter.collectPerformance(), null);
});

test("Programmers captures during the modal fade and reuses metrics only for a fresh duplicate notice", () => {
  const { document } = parseHTML('<div class="challenge-title">섬 연결하기</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code"></textarea><div id="modal-dialog" class="modal fade" aria-hidden="true" style="display:none"><h4 class="modal-title">정답입니다!</h4></div><div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (0.61ms, 86.3MB)</td></tr></tbody></table></div>');
  (document.querySelector("#code") as HTMLTextAreaElement).value = "class Solution {}";
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42861"));
  adapter.beginSubmissionAttempt();
  assert.equal(adapter.detectSubmissionResult(), null);
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.style.display = "block";
  dialog.removeAttribute("aria-hidden");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  assert.equal(adapter.detectSubmissionResult()?.accepted, true, "the .show transition is authoritative before opacity reaches one");
  assert.equal(adapter.collectPerformance(), null, "unchanged old rows are not associated with this submit");
  const notice = document.createElement("div");
  notice.className = "console-failed";
  notice.textContent = "같은 코드로 채점한 결과가 있습니다.";
  document.querySelector(".console-content")!.prepend(notice);
  assert.deepEqual(adapter.collectPerformance(), { executionTime: 0.61, memoryUsage: 86.3, memoryValue: 86.3, memoryUnit: "MB" });
});

test('live SWEA submit anchor and language menu are recognized without treating compile as submit', () => {
  const { document } = parseHTML('<div class="problem_box"><h3>1868. 파핑파핑 지뢰찾기</h3></div><select id="sel_lang" name="lang"><option value="J" selected>JAVA (OpenJDK 8)</option></select><textarea id="textSource">class Solution {}</textarea><a id="btnf_proposal" href="#none">제출</a><a id="btnf_compile">컴파일</a>');
  const select = document.querySelector('#sel_lang')!;
  Object.defineProperty(select, 'selectedOptions', { value: [select.querySelector('option')] });
  const adapter = new SweaAdapter(document, locationFor('https://swexpertacademy.com/main/solvingProblem/solvingProblem.do'));
  assert.equal(adapter.isSubmitControl(document.querySelector('#btnf_proposal')!), true);
  assert.equal(adapter.isSubmitControl(document.querySelector('#btnf_compile')!), false);
  assert.deepEqual(adapter.detectEditor(), { language: 'Java', sourceCode: 'class Solution {}' });
  // The solving page has no authoritative result metric row. Never guess MB;
  // the capture therefore retains an explicit UNKNOWN memory unit.
  assert.equal(adapter.collectPerformance(), null);
});
