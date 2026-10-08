import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountArchive } from '../src/archiveView';

const html = readFileSync(new URL('../src/archive.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Condition was not met within ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function capture(captureId: string, syncState: 'PENDING' | 'SYNCED', sourceCode: string, overrides = {}) {
  return {
    captureId, platform: 'PROGRAMMERS', problemNumber: '42586', title: '기능 개발',
    problemUrl: 'https://school.programmers.co.kr/learn/courses/30/lessons/42586',
    language: 'JavaScript', sourceCode, result: 'ACCEPTED',
    observedAt: '2026-09-15T12:00:00.000Z', solvedAt: '2026-09-15T12:00:00.000Z', syncState, ...overrides
  };
}

function choose(document: Document, select: HTMLSelectElement, value: string): void {
  Array.from(select.querySelectorAll('option')).forEach(option => {
    if (option.value === value) option.setAttribute('selected', '');
    else option.removeAttribute('selected');
  });
  select.dispatchEvent(new document.defaultView!.Event('change'));
}

test('local archive mirrors the dashboard list/detail layout, groups submissions, and shows selected code', async () => {
  const { document } = parseHTML(html);
  mountArchive(document, { load: async () => ({ captures: [
    { ...capture('11111111-1111-4111-8111-111111111111', 'PENDING', 'const first = 1;', { observedAt: '2026-09-15T12:01:00.000Z' }), executionTime: 0, memoryValue: 0, memoryUnit: 'MB' },
    capture('22222222-2222-4222-8222-222222222222', 'SYNCED', '<script>const second = true;</script>'),
    capture('33333333-3333-4333-8333-333333333333', 'SYNCED', 'class Main {}', { platform: 'JUNGOL', problemNumber: '1520', title: '계단 오르기', language: 'Java' })
  ] }) });
  await settle();
  assert.equal(document.querySelector('#archive-count')!.textContent, '3');
  assert.equal(document.querySelector('#archive-filtered-count')!.textContent, '2');
  assert.equal(document.querySelectorAll('.solution-row').length, 2);
  assert.equal(document.querySelectorAll('.solution-row.selected').length, 1);
  assert.equal(document.querySelectorAll('.capture-card').length, 1);
  assert.equal(document.querySelectorAll('.capture-code-details').length, 0);
  assert.equal(document.querySelectorAll('.capture-code-viewer').length, 1);
  assert.equal(document.querySelectorAll('#archive-code-theme').length, 1);
  assert.equal(document.querySelectorAll('.capture-code-theme').length, 0);
  assert.match(document.querySelector('.archive-list')!.textContent!, /풀이 2개/);
  assert.match(document.querySelector('.archive-detail')!.textContent!, /실행 시간0 ms메모리 사용량0 MB/);
  const picker = document.querySelector<HTMLSelectElement>('.submission-picker select')!;
  assert.equal(picker.querySelectorAll('option').length, 2);
  choose(document, picker, '22222222-2222-4222-8222-222222222222');
  const source = document.querySelector<HTMLElement>('.source-code')!;
  assert.equal(source.textContent, '<script>const second = true;</script>');
  assert.equal(source.querySelector('script'), null);
  assert.match(document.querySelector('.archive-detail')!.textContent!, /대시보드 동기화됨/);
  assert.equal(document.querySelectorAll('.code-toggle').length, 0);
});

test('search, platform filter, sort and refresh keep the local list and detail coherent', async () => {
  const { document } = parseHTML(html);
  let fail = false;
  mountArchive(document, { load: async () => fail ? { error: 'STORAGE_ERROR' } : ({ captures: [
    capture('44444444-4444-4444-8444-444444444444', 'PENDING', 'const a = 1;'),
    capture('55555555-5555-4555-8555-555555555555', 'SYNCED', 'class Main {}', { platform: 'JUNGOL', problemNumber: '1520', title: '계단 오르기', language: 'Java', observedAt: '2026-09-16T12:00:00.000Z' })
  ] }) });
  await settle();
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.solution-row'));
  assert.match(rows()[0]!.textContent!, /계단 오르기/);
  choose(document, document.querySelector<HTMLSelectElement>('#archive-sort')!, 'oldest');
  assert.match(rows()[0]!.textContent!, /기능 개발/);
  choose(document, document.querySelector<HTMLSelectElement>('#archive-sort')!, 'problem');
  assert.match(rows()[0]!.textContent!, /계단 오르기/);
  const language = document.querySelector<HTMLSelectElement>('#archive-language')!;
  assert.deepEqual(Array.from(language.querySelectorAll('option')).map(option => option.textContent), ['모든 언어', 'Java', 'JavaScript']);
  choose(document, language, 'Java');
  assert.equal(rows().length, 1);
  assert.match(document.querySelector('.detail-title')!.textContent!, /계단 오르기/);
  choose(document, language, 'ALL');
  const search = document.querySelector<HTMLInputElement>('#archive-search')!;
  search.value = '계단';
  search.dispatchEvent(new document.defaultView!.Event('input'));
  assert.equal(rows().length, 1);
  assert.match(document.querySelector('.detail-title')!.textContent!, /계단 오르기/);
  (document.querySelector('[data-platform="SWEA"]') as HTMLButtonElement).click();
  assert.equal(rows().length, 0);
  assert.match(document.querySelector('.archive-detail')!.textContent!, /왼쪽 목록/);
  fail = true;
  (document.querySelector('#archive-refresh') as HTMLButtonElement).click();
  await settle();
  assert.equal(rows().length, 0);
  assert.equal((document.querySelector('#archive-error') as HTMLElement).hidden, false);
});

test('the single top theme selector highlights the selected solution only', async () => {
  const { document } = parseHTML(html);
  let settings = { lightTheme: 'github-light', darkTheme: 'github-dark' };
  const updates: Array<[string, string]> = [];
  mountArchive(document, {
    load: async () => ({ captures: [
      capture('66666666-6666-4666-8666-666666666666', 'PENDING', 'const first = 1;'),
      capture('77777777-7777-4777-8777-777777777777', 'SYNCED', 'const second = 2;', { platform: 'JUNGOL', problemNumber: '1520', title: '계단 오르기' })
    ], settings }),
    updateThemes: async (lightTheme, darkTheme) => { updates.push([lightTheme, darkTheme]); settings = { lightTheme, darkTheme }; }
  });
  await settle();
  const select = document.querySelector<HTMLSelectElement>('#archive-code-theme')!;
  assert.equal(select.querySelectorAll('option').length, 65);
  assert.deepEqual(Array.from(select.querySelectorAll('optgroup')).map(group => group.label), ['밝은 테마', '어두운 테마']);
  choose(document, select, 'solarized-light');
  assert.deepEqual(updates, [['solarized-light', 'github-dark']]);
  let source = document.querySelector<HTMLElement>('.source-code')!;
  await waitFor(() => source.dataset.shikiTheme === 'solarized-light');
  const firstSource = source;
  (document.querySelectorAll<HTMLButtonElement>('.solution-row')[1]!).click();
  assert.equal(document.querySelectorAll('.capture-code-viewer').length, 1);
  source = document.querySelector<HTMLElement>('.source-code')!;
  assert.notEqual(source, firstSource);
  choose(document, select, 'dracula');
  await waitFor(() => source.dataset.shikiTheme === 'dracula');
  assert.equal(document.querySelector<HTMLElement>('.capture-code-viewer')!.style.colorScheme, 'dark');
  assert.deepEqual(updates, [['solarized-light', 'github-dark'], ['solarized-light', 'dracula']]);
});
