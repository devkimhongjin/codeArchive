import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { HISTORY_SCAN_TIMING_STORAGE_KEY } from '../src/historyTiming';

test('terminal local import ignores a delayed cancel and permits a fresh production scan', async () => {
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
  const timingWrites: Record<string, unknown>[] = [];
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } }, sendMessage: async () => ({}) },
    storage: { local: { set: async (value: Record<string, unknown>) => { timingWrites.push(value); } } } };
  const globals = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome,
    MutationObserver: globalThis.MutationObserver, Element: globalThis.Element, setTimeout: globalThis.setTimeout };
  Object.assign(globalThis, { document, window, chrome, MutationObserver: window.MutationObserver, Element: window.Element,
    setTimeout: ((callback: (...args: unknown[]) => void, _delay?: number) => globals.setTimeout(callback, 1)) as typeof setTimeout });
  const more = document.querySelector<HTMLButtonElement>('#more')!;
  more.addEventListener('click', () => {
    const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.textContent = '12346';
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', '?account=mine&sid=12346');
    document.querySelector('table')!.append(row); more.remove();
  });
  try {
    const contentModule = '../src/content?terminal-cancel';
    await import(contentModule);
    assert.ok(listener);
    let scan: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { scan = value; });
    assert.equal((scan as { status: string }).status, 'SCANNING');
    await new Promise(resolve => globals.setTimeout(resolve, 80));
    let ready: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { ready = value; });
    assert.equal((ready as { status: string }).status, 'READY');
    const learnedSample = (ready as { scanTimingSample?: { durationMs: number } }).scanTimingSample;
    assert.ok((learnedSample?.durationMs ?? 0) > 0);
    assert.deepEqual(timingWrites, [{ [HISTORY_SCAN_TIMING_STORAGE_KEY]: learnedSample }]);

    // Cancel actual scan work, wait for the old task to settle, then prove
    // the first retry gets fresh ownership and reaches a usable READY state.
    let activeScan: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { activeScan = value; });
    assert.equal((activeScan as { status: string }).status, 'SCANNING');
    let scanCancel: unknown;
    listener!({ type: 'LOCAL_HISTORY_CANCEL' }, null, value => { scanCancel = value; });
    assert.equal((scanCancel as { status: string }).status, 'CANCELLING');
    await new Promise(resolve => globals.setTimeout(resolve, 40));
    let interruptedScan: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { interruptedScan = value; });
    assert.equal((interruptedScan as { status: string }).status, 'INTERRUPTED');
    assert.equal(timingWrites.length, 1, 'a cancelled scan must not replace the completed timing sample');
    let firstRetry: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { firstRetry = value; });
    assert.equal((firstRetry as { status: string }).status, 'SCANNING');
    await new Promise(resolve => globals.setTimeout(resolve, 80));
    let retryReady: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { retryReady = value; });
    assert.equal((retryReady as { status: string }).status, 'READY');

    // The same cancelled-owner flag can come from active import work. Its
    // first following scan must also use the new task, not the old flag.
    let activeImport: unknown;
    listener!({ type: 'LOCAL_HISTORY_IMPORT_START', submissionIds: ['12345'] }, null, value => { activeImport = value; });
    assert.equal((activeImport as { status: string }).status, 'IMPORTING');
    let importCancelWhileActive: unknown;
    listener!({ type: 'LOCAL_HISTORY_CANCEL' }, null, value => { importCancelWhileActive = value; });
    assert.equal((importCancelWhileActive as { status: string }).status, 'CANCELLING');
    await new Promise(resolve => globals.setTimeout(resolve, 40));
    let interruptedImport: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { interruptedImport = value; });
    assert.equal((interruptedImport as { status: string }).status, 'INTERRUPTED');
    let importFirstRetry: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { importFirstRetry = value; });
    assert.equal((importFirstRetry as { status: string }).status, 'SCANNING');
    await new Promise(resolve => globals.setTimeout(resolve, 80));
    let importRetryReady: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { importRetryReady = value; });
    assert.equal((importRetryReady as { status: string }).status, 'READY');

    let importing: unknown;
    listener!({ type: 'LOCAL_HISTORY_IMPORT_START', submissionIds: ['12345'] }, null, value => { importing = value; });
    assert.equal((importing as { status: string }).status, 'IMPORTING');
    await new Promise(resolve => globals.setTimeout(resolve, 40));
    let finished: unknown;
    listener!({ type: 'LOCAL_HISTORY_STATUS' }, null, value => { finished = value; });
    assert.equal((finished as { status: string }).status, 'FAILED');
    let cancelled: unknown;
    listener!({ type: 'LOCAL_HISTORY_CANCEL' }, null, value => { cancelled = value; });
    assert.equal((cancelled as { status: string }).status, 'FAILED');
    let retry: unknown;
    listener!({ type: 'LOCAL_HISTORY_SCAN_START' }, null, value => { retry = value; });
    assert.equal((retry as { status: string }).status, 'SCANNING');
  } finally {
    Object.assign(globalThis, globals);
  }
});
