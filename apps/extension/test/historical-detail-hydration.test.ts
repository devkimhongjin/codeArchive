import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { importVisibleJungolHistory, previewJungolHistory } from "../src/historicalJungol";

const cases = [
  { name: "import waits for a late submission-time control after the code shell appears", id: "2001", owner: "9", code: "hello", date: "2026. 9. 22. 오전 11:36:55", accepted: true },
  { name: "late metadata cannot authorize another submission dialog", id: "2002", owner: "9", code: "hello", date: "2026. 9. 22. 오전 11:36:55", accepted: false },
  { name: "late metadata still rejects a different owner", id: "2001", owner: "10", code: "hello", date: "2026. 9. 22. 오전 11:36:55", accepted: false },
  { name: "late metadata still rejects a changed source length", id: "2001", owner: "9", code: "hello!", date: "2026. 9. 22. 오전 11:36:55", accepted: false },
  { name: "late metadata still rejects an invalid exact submission date", id: "2001", owner: "9", code: "hello", date: "2026. 2. 30. 오전 11:36:55", accepted: false },
  { name: "source navigation while metadata loads cannot click or store the old submission", id: "2001", owner: "9", code: "hello", date: "2026. 9. 22. 오전 11:36:55", accepted: false, moved: true }
];
for (const sample of cases) test(sample.name, async () => {
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/9">@mine</a>
    <a href="/account/9/edit">정보 수정</a><a class="active" href="/account/9/submission">제출현황</a>
    <table><tr><td data-col="번호"><span class="sl-id">2001</span></td>
      <td data-col="제출자"><a href="/account/9">mine</a></td>
      <td data-col="문제"><a href="/problem/2000">Fixture #2000</a></td>
      <td data-col="결과">정답 <span>100점</span></td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?sid=2001">Java 8</a></td></tr></table></body></html>`);
  const location = new URL("https://jungol.co.kr/account/9/submission") as unknown as Location;
  const preview = previewJungolHistory(document, location);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  const originalTimer = globalThis.setTimeout;
  const originalObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  // Shorten only the application's wait budget; preserve ordering of fixture updates.
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) =>
    originalTimer(callback, Math.min(delay ?? 0, 100))) as typeof setTimeout;
  let timeClicks = 0, stores = 0;
  document.querySelector('td[data-col="언어"] a')!.addEventListener("click", event => {
    event.preventDefault();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "제출 상세");
    dialog.innerHTML = `<span class="sd-id">#${sample.id}</span><code class="hljs"></code><button>닫기</button>`;
    dialog.querySelector("button")!.addEventListener("click", () => dialog.remove());
    document.body.append(dialog);
    originalTimer(() => {
      if ("moved" in sample) location.href = "https://jungol.co.kr/account/10/submission";
      dialog.querySelector("code")!.textContent = sample.code;
      const metadata = document.createElement("div");
      metadata.innerHTML = `<span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span>
        <a href="/account/${sample.owner}">mine</a><a href="/problem/2000">Fixture #2000</a>
        <span class="sd-meta-item"><div role="button" aria-expanded="false"><span class="time">어제</span></div></span>`;
      const trigger = metadata.querySelector<HTMLElement>('[role="button"]')!;
      trigger.addEventListener("click", () => {
        timeClicks++;
        if (trigger.getAttribute("aria-expanded") === "true") {
          trigger.setAttribute("aria-expanded", "false"); trigger.querySelector(".paper")?.remove(); return;
        }
        trigger.setAttribute("aria-expanded", "true");
        const paper = document.createElement("div"); paper.className = "paper";
        paper.innerHTML = `<div class="content">${sample.date}</div>`;
        trigger.append(paper);
      });
      dialog.append(metadata);
    }, 5);
  });
  try {
    const failures: string[] = [];
    const result = await importVisibleJungolHistory(document, location, preview.candidates, async capture => {
      stores++;
      assert.equal(capture.solvedAt, "2026-09-22T02:36:55.000Z");
      return { ok: true, created: true };
    }, () => undefined, reason => failures.push(reason));
    assert.deepEqual(result, sample.accepted ? { saved: 1, duplicate: 0, skipped: 0 } : { saved: 0, duplicate: 0, skipped: 1 });
    assert.equal(stores, sample.accepted ? 1 : 0);
    assert.equal(timeClicks, sample.id === "2001" && !("moved" in sample) ? 2 : 0);
    assert.deepEqual(failures, sample.accepted ? [] : [sample.id === "2001" ? "DETAIL_UNVERIFIED" : "DETAIL_NOT_FOUND"]);
    if (sample.id === "2001") assert.equal(document.querySelector('[role="dialog"]'), null);
    else assert.equal(document.querySelector('[role="dialog"] .sd-id')!.textContent, "#2002", "an unrelated dialog must remain untouched");
  } finally { globalThis.setTimeout = originalTimer; globalThis.MutationObserver = originalObserver; }
});
