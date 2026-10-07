import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { importVisibleJungolHistory, previewJungolHistory } from "../src/historicalJungol";

test("verified import keeps counts and reports a safe storage failure reason", async () => {
  const { document } = parseHTML(`<html><body><a class="crumb" href="/account/9">@mine</a>
    <a href="/account/9/edit">정보 수정</a><a class="active" href="/account/9/submission">제출 현황</a>
    <table><tr><td data-col="번호"><span class="sl-id">2001</span></td>
      <td data-col="제출자"><a href="/account/9">mine</a></td>
      <td data-col="문제"><a href="/problem/2000">Fixture #2000</a></td>
      <td data-col="결과">정답 <span>100점</span></td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?sid=2001">Java 8</a></td></tr></table></body></html>`);
  const location = new URL("https://jungol.co.kr/account/9/submission") as unknown as Location;
  const preview = previewJungolHistory(document, location);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  document.querySelector('td[data-col="언어"] a')!.addEventListener("click", event => {
    event.preventDefault();
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "제출 상세");
    dialog.innerHTML = `<span class="sd-heading-score">100점</span><span class="sd-heading-status">정답</span>
      <a href="/account/9">mine</a><a href="/problem/2000">Fixture #2000</a><span class="sd-id">#2001</span>
      <span class="sd-meta-item"><div role="button"><span class="time">어제</span></div></span>
      <code class="hljs">hello</code><button>닫기</button>`;
    dialog.querySelector('[role="button"]')!.addEventListener("click", () => {
      const paper = document.createElement("div"); paper.className = "paper";
      paper.innerHTML = '<div class="content">2026. 9. 29. 오전 10:00:00</div>';
      dialog.querySelector('[role="button"]')!.append(paper);
    });
    dialog.querySelector("button")!.addEventListener("click", () => dialog.remove());
    document.body.append(dialog);
  });
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    for (const [response, reason] of [
      [{ ok: false, error: "INVALID_HISTORICAL_CAPTURE" }, "STORE_REJECTED"],
      [{ ok: false, error: "STORAGE_ERROR" }, "STORE_FAILED"],
      [{ ok: true, created: true }, null]
    ] as const) {
      const failures: string[] = [];
      const result = await importVisibleJungolHistory(document, location, preview.candidates,
        async () => response, () => undefined, failure => failures.push(failure));
      assert.deepEqual(result, response.ok ? { saved: 1, duplicate: 0, skipped: 0 } : { saved: 0, duplicate: 0, skipped: 1 });
      assert.deepEqual(failures, reason ? [reason] : []);
      assert.equal(document.querySelector('[role="dialog"]'), null);
    }
    document.querySelector('td[data-col="번호"]')!.textContent = "different";
    const failures: string[] = [];
    await importVisibleJungolHistory(document, location, preview.candidates, async () => assert.fail("changed list cannot store"),
      () => undefined, failure => failures.push(failure));
    assert.deepEqual(failures, ["LIST_CHANGED"]);
  } finally { globalThis.MutationObserver = previous; }
});
