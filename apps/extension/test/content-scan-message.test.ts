import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';

test('content scanner joins legacy requests and publishes a moved source as terminal after it returns', async () => {
  const { document } = parseHTML(`<html><body>
    <button role="switch" aria-checked="true">내 제출</button><button aria-label="@mine 필터 해제"></button>
    <table><tr><th>번호</th></tr><tr><td data-col="번호">12345</td>
      <td data-col="문제"><a href="/problem/1520">계단 오르기 #1520</a></td>
      <td data-col="결과">정답 <span>100점</span></td><td data-col="시간">25ms</td>
      <td data-col="메모리">33.0MB</td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?account=mine&amp;sid=12345">Java 8</a></td></tr></table>
    <button id="more">더 불러오기</button></body></html>`);
  const location = new URL('https://jungol.co.kr/submission?account=mine');
  const window = document.defaultView!;
  Object.defineProperty(window, 'location', { value: location, configurable: true });
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } },
    sendMessage: async () => ({}) } };
  const globals = { document: globalThis.document, window: globalThis.window,
    chrome: globalThis.chrome, MutationObserver: globalThis.MutationObserver,
    setTimeout: globalThis.setTimeout };
  Object.assign(globalThis, { document, window, chrome, MutationObserver: window.MutationObserver,
    setTimeout: ((callback: (...args: unknown[]) => void, _delay?: number) =>
      globals.setTimeout(callback, 1)) as typeof setTimeout });
  const more = document.querySelector<HTMLButtonElement>('#more')!;
  let clicks = 0;
  more.addEventListener('click', () => {
    clicks++;
    const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.textContent = String(12345 + clicks);
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', `?account=mine&sid=${12345 + clicks}`);
    document.querySelector('table')!.append(row);
    if (clicks === 2) more.remove();
  });
  try {
    await import('../src/content');
    assert.ok(listener);
    let start: unknown;
    let legacy: unknown;
    listener!({ type: 'HISTORY_SCAN_START' }, null, value => { start = value; });
    listener!({ type: 'HISTORY_PREVIEW' }, null, value => { legacy = value; });
    assert.equal(clicks, 1);
    assert.deepEqual(legacy, start);
    await new Promise(resolve => globals.setTimeout(resolve, 50));

    // Local collection owns the scanner. A source move must settle rather
    // than leaving the task permanently SCANNING, even if the user returns
    // to the original owned listing before asking for status or retrying.
    let localStart: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { localStart = value; });
    assert.equal((localStart as { status: string }).status, 'SCANNING');
    // Status reads the current source document visibility directly; it does
    // not wait for the old scanner mirror interval or invent row progress.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    let freshStatus: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { freshStatus = value; });
    const freshProgress = (freshStatus as { progress?: { sourceVisibility?: string; lastProgressAt?: unknown } }).progress;
    assert.equal(freshProgress?.sourceVisibility, 'hidden');
    assert.equal(typeof freshProgress?.lastProgressAt, 'number');
    location.href = 'https://jungol.co.kr/submission?account=other';
    await new Promise(resolve => globals.setTimeout(resolve, 30));
    location.href = 'https://jungol.co.kr/submission?account=mine';
    await new Promise(resolve => globals.setTimeout(resolve, 30));
    let terminal: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { terminal = value; });
    assert.equal((terminal as { status: string }).status, 'SCAN_INCOMPLETE');
    let terminalCancel: unknown;
    listener!({ type: 'LOCAL_HISTORY_CANCEL' }, null, value => { terminalCancel = value; });
    assert.equal((terminalCancel as { status: string }).status, 'SCAN_INCOMPLETE');
    // A terminal local task must not be revived when a legacy status read sees
    // a newly rendered table.
    const terminalReplacement = document.querySelector('table')!.cloneNode(true);
    document.querySelector('table')!.replaceWith(terminalReplacement);
    listener!({ type: 'HISTORY_SCAN_STATUS' }, null, () => undefined);
    await new Promise(resolve => globals.setTimeout(resolve, 20));
    let stillTerminal: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { stillTerminal = value; });
    assert.equal((stillTerminal as { status: string }).status, 'SCAN_INCOMPLETE');
    let retry: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { retry = value; });
    assert.equal((retry as { status: string }).status, 'SCANNING');
    // A legacy status read can observe the site replacing its table during a
    // local scan. Its replacement run must still settle the owned local task.
    const replacementTable = document.querySelector('table')!.cloneNode(true) as HTMLTableElement;
    const added = replacementTable.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!.cloneNode(true) as HTMLTableRowElement;
    added.querySelector('td[data-col="번호"]')!.textContent = '19999';
    added.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=19999');
    replacementTable.append(added);
    const expectedRows = replacementTable.querySelectorAll('tr').length;
    document.querySelector('table')!.replaceWith(replacementTable);
    let legacyReplacement: unknown;
    listener!({ type: 'HISTORY_SCAN_STATUS' }, null, value => { legacyReplacement = value; });
    assert.equal((legacyReplacement as { status: string }).status, 'SCANNING');
    await new Promise(resolve => globals.setTimeout(resolve, 20));
    let replacementStatus: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { replacementStatus = value; });
    // The local task receives the replacement run's immediate progress report;
    // it is not orphaned behind the legacy scanner's safety wait windows.
    assert.equal((replacementStatus as { progress?: { rows?: number } }).progress?.rows, expectedRows);
  } finally {
    Object.assign(globalThis, globals);
  }
});
