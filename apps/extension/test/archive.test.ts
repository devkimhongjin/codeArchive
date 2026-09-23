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

function capture(captureId: string, syncState: 'PENDING' | 'SYNCED', sourceCode: string) {
  return {
    captureId,
    platform: 'PROGRAMMERS',
    problemNumber: '42586',
    title: '기능 개발',
    problemUrl: 'https://school.programmers.co.kr/learn/courses/30/lessons/42586',
    language: 'JavaScript',
    sourceCode,
    result: 'ACCEPTED',
    observedAt: '2026-09-15T12:00:00.000Z',
    solvedAt: '2026-09-15T12:00:00.000Z',
    syncState
  };
}

test('archive renders pending and retained synced captures with source as text', async () => {
  const { document } = parseHTML(html);
  mountArchive(document, {
    load: async () => ({ captures: [
      { ...capture('11111111-1111-4111-8111-111111111111', 'PENDING', 'const pending = true;'), executionTime: 0, memoryValue: 0, memoryUnit: 'MB' },
      capture('22222222-2222-4222-8222-222222222222', 'SYNCED', '<script>const synced = true;</script>')
    ] })
  });
  await settle();
  assert.equal(document.querySelector('#archive-count')!.textContent, '2');
  assert.equal(document.querySelector('#archive-build-label')!.textContent, 'vdev · dev+source-unknown');
  assert.equal(document.querySelector('#archive-updated-label')!.textContent, 'Updated dev');
  assert.equal(document.querySelectorAll('.capture-card').length, 2);
  assert.equal(document.querySelectorAll('.capture-code-viewer .capture-code-theme').length, 2);
  assert.equal(document.querySelectorAll('.archive-card > .archive-theme-controls').length, 0);
  assert.match(document.querySelector('.archive-list')!.textContent!, /대시보드 동기화됨/);
  assert.match(document.querySelector('.archive-list')!.textContent!, /풀이 시간/);
  assert.match(document.querySelector('.archive-list')!.textContent!, /실행 시간0 ms메모리 사용량0 MB/);
  assert.match(document.querySelector('.archive-list')!.textContent!, /실행 시간정보 없음메모리 사용량정보 없음/);
  assert.equal(document.querySelectorAll('.source-details').length, 0);
  assert.equal(document.querySelectorAll('.capture-code-gutter span').length, 2);
  assert.equal(document.querySelectorAll('.source-code')[1]!.textContent, '<script>const synced = true;</script>');
  assert.equal(document.querySelectorAll('.source-code')[1]!.querySelector('script'), null);
});

test('archive clears stale records and reports storage failures', async () => {
  const { document } = parseHTML(html);
  let shouldFail = false;
  mountArchive(document, {
    load: async () => {
      if (shouldFail) return { captures: [], error: 'STORAGE_ERROR' };
      return { captures: [capture('33333333-3333-4333-8333-333333333333', 'PENDING', 'const first = 1;')] };
    }
  });
  await settle();
  assert.equal(document.querySelectorAll('.capture-card').length, 1);
  shouldFail = true;
  (document.querySelector('#archive-refresh') as HTMLButtonElement).click();
  await settle();
  assert.equal(document.querySelectorAll('.capture-card').length, 0);
  assert.equal((document.querySelector('#archive-error') as HTMLElement).hidden, false);
});

test('archive theme changes call the local updater and re-render with the selected palette metadata', async () => {
  const { document } = parseHTML(html);
  let settings = { lightTheme: 'github-light', darkTheme: 'github-dark' };
  const updates: Array<[string, string]> = [];
  mountArchive(document, {
    load: async () => ({ captures: [capture('44444444-4444-4444-8444-444444444444', 'PENDING', 'const theme = true;')], settings }),
    updateThemes: async (lightTheme, darkTheme) => { updates.push([lightTheme, darkTheme]); settings = { lightTheme, darkTheme }; }
  });
  for (let i = 0; i < 12; i += 1) await settle();
  const select = document.querySelector<HTMLSelectElement>('.capture-code-theme')!;
  assert.equal(select.querySelectorAll('option').length, 10);
  assert.deepEqual(Array.from(select.querySelectorAll('optgroup')).map(group => group.label), ['밝은 테마', '어두운 테마']);
  select.querySelector('option[value="github-light"]')!.removeAttribute('selected');
  select.querySelector('option[value="solarized-light"]')!.setAttribute('selected', '');
  select.dispatchEvent(new document.defaultView!.Event('change'));
  for (let i = 0; i < 12; i += 1) await settle();
  assert.deepEqual(updates, [['solarized-light', 'github-dark']]);
  assert.equal(select.value, 'solarized-light');
  assert.equal(document.querySelectorAll('.capture-card').length, 1);
  const source = document.querySelector<HTMLElement>('.source-code')!;
  // Shiki initializes its WASM engine asynchronously. Await the observable
  // render completion instead of assuming a fixed wall-clock delay is enough
  // on every CI host.
  await waitFor(() => source.dataset.shikiTheme === 'solarized-light');
  assert.equal(source.dataset.shikiTheme, 'solarized-light');
  assert.notEqual(source.style.backgroundColor, '');
  select.querySelector('option[value="solarized-light"]')!.removeAttribute('selected');
  select.querySelector('option[value="one-dark-pro"]')!.setAttribute('selected', '');
  select.dispatchEvent(new document.defaultView!.Event('change'));
  await waitFor(() => source.dataset.shikiTheme === 'one-dark-pro');
  assert.equal(document.querySelector<HTMLElement>('.capture-code-viewer')!.style.colorScheme, 'dark');
  assert.deepEqual(updates, [['solarized-light', 'github-dark'], ['solarized-light', 'one-dark-pro']]);
});

test('choosing a theme in one local code viewer updates the other viewer', async () => {
  const { document } = parseHTML(html);
  mountArchive(document, {
    load: async () => ({ captures: [
      capture('55555555-5555-4555-8555-555555555555', 'PENDING', 'const first = 1;'),
      capture('66666666-6666-4666-8666-666666666666', 'SYNCED', 'const second = 2;')
    ] })
  });
  await settle();
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('.capture-code-theme'));
  assert.equal(selects.length, 2);
  const firstSelect = selects[0]!;
  const secondSelect = selects[1]!;
  firstSelect.querySelector('option[value="github-light"]')!.removeAttribute('selected');
  firstSelect.querySelector('option[value="dracula"]')!.setAttribute('selected', '');
  firstSelect.dispatchEvent(new document.defaultView!.Event('change'));
  assert.equal(secondSelect.value, 'dracula');
  await waitFor(() => Array.from(document.querySelectorAll<HTMLElement>('.source-code')).every(source => source.dataset.shikiTheme === 'dracula'));
});
