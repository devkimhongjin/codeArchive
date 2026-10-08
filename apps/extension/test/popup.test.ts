import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountPopup } from '../src/popupView';
import type { GithubCommitStatus } from '../src/relay';
const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function record(id: string, syncState = 'SYNCED', problemNumber = id) {
  return { captureId: id, platform: 'SWEA', problemNumber, title: `Problem ${id}`, problemUrl: 'https://example.test', language: 'Java', result: 'ACCEPTED', syncState, observedAt: '2026-09-18T00:00:00Z', solvedAt: '2026-09-18T00:00:00Z', executionTime: 0, memoryValue: 0, memoryUnit: 'KB' };
}
test('popup has only a dashboard shortcut and no local options, history shortcut or placeholder logo', async () => {
  const { document } = parseHTML(html);
  mountPopup(document, { load: async () => ({ settings: {}, recentCaptures: [] }), copy: async () => {} }); await settle();
  for (const selector of ['.logo', '#capture-card', '#auto-download', '#auto-sync', '#automation-help', '#local-history-link', '.recent-archive-link']) assert.equal(document.querySelector(selector), null, selector);
  assert.doesNotMatch(document.body.textContent!, /풀이는 먼저 이 브라우저|로컬 보관|로컬 저장 전체보기/);
  assert.equal(document.querySelector('.dashboard-link')?.getAttribute('href'), 'dashboard.html');
  assert.equal(document.querySelector('.dashboard-link')?.getAttribute('target'), '_blank');
});
test('recent list includes only synced distinct problems and retains performance and KST time', async () => {
  const { document } = parseHTML(html);
  mountPopup(document, { load: async () => ({ settings: {}, recentCaptures: [record('pending', 'PENDING'), record('one', 'SYNCED', '1'), record('duplicate', 'SYNCED', '1'), record('two'), record('three'), record('four')] }), copy: async () => {} }); await settle();
  assert.equal(document.querySelectorAll('.recent-item').length, 3);
  assert.doesNotMatch(document.querySelector('#recent-list')!.textContent!, /pending|duplicate|four/);
  assert.match(document.querySelector('#recent-list')!.textContent!, /0 ms · 메모리 0 KB/);
  assert.equal(document.querySelector('.recent-title')?.getAttribute('href'), 'dashboard.html');
  assert.equal(document.querySelector('#recent-count')?.textContent, '3문제');
});
test('GitHub switch opens management when no repository target is connected', async () => {
  const { document } = parseHTML(html); const opened: string[] = []; const patches: unknown[] = [];
  mountPopup(document, { load: async () => ({ settings: { githubAutoCommitEnabled: true, relay: { status: 'CONFIRMED' } } }), copy: async () => {}, openDashboard: view => { opened.push(view); }, updateSettings: async patch => { patches.push(patch); } }); await settle();
  const toggle = document.querySelector<HTMLInputElement>('#github-auto')!;
  assert.equal(toggle.checked, true); assert.equal(toggle.disabled, false);
  toggle.dispatchEvent(new document.defaultView!.Event('click', { cancelable: true }));
  assert.deepEqual(opened, ['github']); assert.deepEqual(patches, []);
});

test('connected GitHub switch saves directly and coalesces clicks until acknowledged', async () => {
  const { document } = parseHTML(html); const opened: string[] = []; const commands: unknown[] = [];
  let enabled = false; let resolve!: (value: { ok: boolean; relayReady: boolean }) => void;
  mountPopup(document, { load: async () => ({ settings: { githubAutoCommitEnabled: enabled, githubTargetConfigured: true,
    accountId: '9', accountSettingsVersion: 7, relay: { status: 'CONFIRMED' } } }), copy: async () => {}, openDashboard: view => opened.push(view),
    updateGithubAutomation: command => { commands.push(command); return new Promise(done => { resolve = done; }); } });
  await settle();
  const toggle = document.querySelector<HTMLInputElement>('#github-auto')!;
  const click = () => toggle.dispatchEvent(new document.defaultView!.Event('click', { cancelable: true }));
  click(); click(); assert.equal(commands.length, 1); assert.equal(toggle.disabled, true);
  assert.deepEqual(commands, [{ enabled: true, accountId: '9', settingsVersion: 7 }]); assert.deepEqual(opened, []);
  enabled = true; resolve({ ok: true, relayReady: true }); await settle(); await settle();
  assert.equal(toggle.checked, true); assert.equal(toggle.disabled, false); assert.equal(toggle.getAttribute('aria-checked'), 'true');
});

test('server-disconnected target redirects while failed saves retain the confirmed switch value', async () => {
  const { document } = parseHTML(html); const opened: string[] = []; let needsTarget = true;
  mountPopup(document, { load: async () => ({ settings: { githubAutoCommitEnabled: true, githubTargetConfigured: true,
    accountId: '9', accountSettingsVersion: 7 } }), copy: async () => {}, openDashboard: view => opened.push(view),
    updateGithubAutomation: async () => needsTarget ? { ok: false, needsTarget: true } : { ok: false, error: 'SETTINGS_CHANGED' } });
  await settle(); const toggle = document.querySelector<HTMLInputElement>('#github-auto')!;
  const click = () => toggle.dispatchEvent(new document.defaultView!.Event('click', { cancelable: true }));
  click(); await settle(); await settle(); assert.deepEqual(opened, ['github']);
  needsTarget = false; click(); await settle(); await settle();
  assert.equal(toggle.checked, true); assert.deepEqual(opened, ['github']);
  assert.match(document.querySelector('#error')!.textContent!, /설정이 변경/);
});

test('saved flag with failed relay renewal displays recovery guidance', async () => {
  const { document } = parseHTML(html);
  mountPopup(document, { load: async () => ({ settings: { githubAutoCommitEnabled: true, githubTargetConfigured: true,
    accountId: '9', accountSettingsVersion: 7 } }), copy: async () => {},
    updateGithubAutomation: async () => ({ ok: true, relayReady: false, error: 'RELAY_REFRESH_REQUIRED' }) });
  await settle(); document.querySelector('#github-auto')!.dispatchEvent(new document.defaultView!.Event('click', { cancelable: true }));
  await settle(); await settle(); assert.match(document.querySelector('#error')!.textContent!, /설정은 저장.*연결을 갱신/);
});
test('popup renders synced rows without waiting for remote commit status and refreshes on storage progress', async () => {
  const { document } = parseHTML(html); let refresh: (() => void) | undefined; let captures = [record('one')];
  mountPopup(document, { load: async () => ({ settings: {}, recentCaptures: captures }), copy: async () => {}, subscribeProgress: callback => { refresh = callback; }, loadGithubStatuses: async () => new Promise(() => {}) }); await settle();
  assert.match(document.querySelector('#recent-list')!.textContent!, /Problem one/);
  captures = [record('two')]; refresh?.(); await settle();
  assert.match(document.querySelector('#recent-list')!.textContent!, /Problem two/);
});
test('retry button coalesces clicks and clears after relay recovery', async () => {
  const { document } = parseHTML(html); let status = 'RELAY_ERROR', calls = 0; let resolve!: () => void;
  mountPopup(document, { load: async () => ({ settings: { relay: { status } } }), copy: async () => {}, retryRelay: () => { calls++; return new Promise<void>(done => { resolve = done; }); } }); await settle();
  const retry = document.querySelector<HTMLButtonElement>('#retry-relay')!;
  assert.equal(retry.hidden, false); retry.click(); retry.click(); assert.equal(calls, 1);
  status = 'CONFIRMED'; resolve(); await settle(); await settle();
  assert.equal(retry.hidden, true); assert.equal(document.querySelector('#automation-status')?.textContent, '자동 동기화 중');
});
test('state error clears old rows instead of implying successful sync', async () => {
  const { document } = parseHTML(html); let refresh: (() => void) | undefined; let failed = false;
  mountPopup(document, { load: async () => failed ? { error: 'STORAGE_ERROR' } : { settings: {}, recentCaptures: [record('one')] }, copy: async () => {}, subscribeProgress: callback => { refresh = callback; } }); await settle();
  failed = true; refresh?.(); await settle(); assert.equal(document.querySelector('.recent-item'), null); assert.equal(document.querySelector<HTMLElement>('#error')!.hidden, false);
});

test('remote status polling retains confirmed labels and DOM while delayed or unavailable', async () => {
  const { document } = parseHTML(html); let refresh!: () => void;
  let statusCalls = 0; let resolve!: (value: { statuses: Record<string, GithubCommitStatus> }) => void;
  mountPopup(document, {
    load: async () => ({ settings: { accountId: '1' }, recentCaptures: [record('one')] }), copy: async () => {},
    subscribeProgress: callback => { refresh = callback; },
    loadGithubStatuses: () => ++statusCalls === 1 ? Promise.resolve({ statuses: { one: 'SUCCEEDED' } }) : new Promise(done => { resolve = done; }),
  });
  await settle(); const item = document.querySelector('.recent-item');
  assert.equal(document.querySelector('.github-label')?.textContent, 'GitHub 완료');
  refresh(); await settle(); refresh(); refresh(); await settle();
  assert.equal(statusCalls, 2);
  assert.equal(document.querySelector('.recent-item'), item);
  assert.equal(document.querySelector('.github-label')?.textContent, 'GitHub 완료');
  resolve({ statuses: {} }); await settle(); await settle();
  assert.equal(document.querySelector('.recent-item'), item);
  assert.equal(document.querySelector('.github-label')?.textContent, 'GitHub 완료');
  resolve({ statuses: { one: 'PENDING' } }); await settle();
  assert.equal(document.querySelector('.github-label')?.textContent, '커밋 대기');
});

test('cached labels do not cross accounts or replacement submissions of the same problem', async () => {
  const { document } = parseHTML(html); let refresh!: () => void; let accountId = '1'; let captureId = 'one';
  let statuses: Record<string, GithubCommitStatus> = { one: 'SUCCEEDED' };
  mountPopup(document, {
    load: async () => ({ settings: { accountId }, recentCaptures: [record(captureId, 'SYNCED', '1')] }), copy: async () => {},
    subscribeProgress: callback => { refresh = callback; }, loadGithubStatuses: async () => ({ statuses }),
  });
  await settle(); assert.equal(document.querySelector('.github-label')?.textContent, 'GitHub 완료');
  accountId = '2'; statuses = {}; refresh(); await settle(); assert.equal(document.querySelector('.github-label'), null);
  statuses = { one: 'SUCCEEDED' }; refresh(); await settle();
  captureId = 'two'; statuses = {}; refresh(); await settle(); assert.equal(document.querySelector('.github-label'), null);
});

test('GitHub toggles remain usable during remote polling and discard pre-toggle responses', async () => {
  const { document } = parseHTML(html); let resolve!: (value: { statuses: Record<string, GithubCommitStatus> }) => void; let writes = 0;
  mountPopup(document, {
    load: async () => ({ settings: { accountId: '1', accountSettingsVersion: 1, githubTargetConfigured: true, githubAutoCommitEnabled: false }, recentCaptures: [record('one')] }),
    copy: async () => {}, loadGithubStatuses: () => new Promise(done => { resolve = done; }),
    updateGithubAutomation: async () => { writes++; return { ok: true, relayReady: true }; },
  });
  await settle();
  document.querySelector('#github-auto')!.dispatchEvent(new document.defaultView!.Event('click', { cancelable: true }));
  await settle(); assert.equal(writes, 1);
  resolve({ statuses: { one: 'SUCCEEDED' } }); await settle(); await settle();
  assert.equal(document.querySelector('.github-label'), null);
});
