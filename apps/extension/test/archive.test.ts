import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountArchive } from '../src/archiveView';

const html = readFileSync(new URL('../src/archive.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

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
      capture('11111111-1111-4111-8111-111111111111', 'PENDING', 'const pending = true;'),
      capture('22222222-2222-4222-8222-222222222222', 'SYNCED', '<script>const synced = true;</script>')
    ] })
  });
  await settle();
  assert.equal(document.querySelector('#archive-count')!.textContent, '2');
  assert.equal(document.querySelectorAll('.capture-card').length, 2);
  assert.match(document.querySelector('.archive-list')!.textContent!, /대시보드 동기화됨/);
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
  const select = document.querySelector<HTMLSelectElement>('#archive-light-theme')!;
  const darkSelect = document.querySelector<HTMLSelectElement>('#archive-dark-theme')!;
  darkSelect.querySelector('option[value="github-dark"]')!.setAttribute('selected', '');
  select.querySelector('option[value="github-light"]')!.removeAttribute('selected');
  select.querySelector('option[value="solarized-light"]')!.setAttribute('selected', '');
  select.dispatchEvent(new document.defaultView!.Event('change'));
  for (let i = 0; i < 12; i += 1) await settle();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(updates, [['solarized-light', 'github-dark']]);
  assert.equal(select.value, 'solarized-light');
  assert.equal(document.querySelectorAll('.capture-card').length, 1);
  assert.equal(document.querySelector<HTMLElement>('.source-code')!.dataset.shikiTheme, 'solarized-light');
  assert.notEqual(document.querySelector<HTMLElement>('.source-code')!.style.backgroundColor, '');
});
