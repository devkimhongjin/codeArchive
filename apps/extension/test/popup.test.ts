import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountPopup } from '../src/popupView';
import type { GithubCommitStatus } from '../src/relay';
const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('pending sources show temporary storage separately from synchronized rows and clear after delivery', async () => {
  const { document } = parseHTML(html);
  let pendingCount = 2, refresh!: () => void;
  mountPopup(document, { load: async () => ({ pendingCount, settings: { accountId: '1', autoSyncEnabled: true, relay: { status: 'OFFLINE' } }, recentCaptures: [] }),
    copy: async () => {}, subscribeProgress: callback => { refresh = callback; } });
  await settle();
  assert.equal(document.querySelector<HTMLElement>('#pending-uploads')!.hidden, false);
  assert.match(document.querySelector('#pending-uploads')!.textContent!, /임시 저장 2개.*브라우저를 다시 켜도/);
  assert.equal(document.querySelectorAll('.recent-item').length, 0);
  pendingCount = 0; refresh(); await settle();
  assert.equal(document.querySelector<HTMLElement>('#pending-uploads')!.hidden, true);
});

test('pending UI advises login or consent instead of claiming completed synchronization', async () => {
  for (const settings of [{ accountId: '1', autoSyncEnabled: true, relay: { status: 'AUTH_EXPIRED' } },
    { accountId: '1', autoSyncEnabled: false, relay: { status: 'CONFIRMED' } }]) {
    const { document } = parseHTML(html);
    mountPopup(document, { load: async () => ({ pendingCount: 1, settings }), copy: async () => {} }); await settle();
    assert.match(document.querySelector('#pending-uploads')!.textContent!, settings.autoSyncEnabled ? /같은 계정으로 로그인/ : /자동 동기화를 켜면/);
    assert.equal(document.querySelectorAll('.recent-item').length, 0);
  }
});
test('recent problem actions retrieve server code and show copy/download feedback', async () => {
  const { document } = parseHTML(html), copied: string[] = [], requested: string[] = [];
  mountPopup(document, { load: async () => ({ settings: {}, recentCaptures: [record('one')] }),
    copy: async text => { copied.push(text); }, copyCapture: async id => { requested.push(id); return { ok: true, text: 'synthetic source' }; },
    downloadCapture: async id => { requested.push(id); return { ok: true }; } });
  await settle();
  document.querySelector<HTMLButtonElement>('[aria-label="one 코드 복사"]')!.click(); await settle();
  assert.deepEqual(copied, ['synthetic source']); assert.match(document.querySelector('.recent-actions')!.textContent!, /복사했습니다/);
  document.querySelector<HTMLButtonElement>('[aria-label="one 다운로드"]')!.click(); await settle();
  assert.deepEqual(requested, ['one', 'one']); assert.match(document.querySelector('.recent-actions')!.textContent!, /다운로드를 시작했습니다/);
});
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
test('recent-server failure retains the GitHub switch and saved target, then recovers on refresh', async () => {
  const {document}=parseHTML(html);let refresh!:()=>void, failed=false;
  const settings={accountId:'9',accountSettingsVersion:7,githubAutoCommitEnabled:true,githubTargetConfigured:true,relay:{status:'CONFIRMED'}};
  const opened:string[]=[],commands:unknown[]=[];
  mountPopup(document,{load:async()=>({settings,recentCaptures:failed?[]:[record('one')],...(failed?{recentError:'SERVER_UNAVAILABLE'}:{})}),copy:async()=>{},
    subscribeProgress:callback=>{refresh=callback},openDashboard:view=>opened.push(view),
    updateGithubAutomation:async command=>{commands.push(command);return {ok:false,error:'SAVE_FAILED'}},retryRelay:async()=>{}});
  await settle();failed=true;refresh();await settle();
  const toggle=document.querySelector<HTMLInputElement>('#github-auto')!;
  assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);
  assert.equal(document.querySelector('.recent-item'),null);
  assert.equal(document.querySelector<HTMLElement>('#recent-error')!.hidden,false);
  assert.equal(document.querySelector('#automation-status')!.textContent,'서버 연결 확인 필요');
  toggle.dispatchEvent(new document.defaultView!.Event('click',{cancelable:true}));await settle();await settle();
  assert.deepEqual(opened,[]);assert.deepEqual(commands,[{enabled:false,accountId:'9',settingsVersion:7}]);
  failed=false;refresh();await settle();
  assert.equal(document.querySelector<HTMLElement>('#recent-error')!.hidden,true);
  assert.equal(document.querySelector('#automation-status')!.textContent,'자동 동기화 중');
  assert.match(document.querySelector('#recent-list')!.textContent!,/Problem one/);
});
test('a slow popup refresh cannot block a verified GitHub toggle or overwrite its newer acknowledgement', async () => {
  const {document}=parseHTML(html);let refresh!:()=>void, release!:(value:unknown)=>void, loads=0, calls=0;
  let enabled=true, version=7;
  const snapshot=()=>({settings:{accountId:'9',accountSettingsVersion:version,githubAutoCommitEnabled:enabled,githubTargetConfigured:true},recentCaptures:[]});
  const old=snapshot();
  mountPopup(document,{load:()=>++loads===2?new Promise(resolve=>{release=resolve}):Promise.resolve(snapshot()),copy:async()=>{},
    subscribeProgress:callback=>{refresh=callback},updateGithubAutomation:async command=>{
      calls++;assert.deepEqual(command,{enabled:false,accountId:'9',settingsVersion:7});enabled=false;version=8;return {ok:true,relayReady:true};
    }});
  await settle();refresh();await settle();
  const toggle=document.querySelector<HTMLInputElement>('#github-auto')!;
  toggle.dispatchEvent(new document.defaultView!.Event('click',{cancelable:true}));await settle();
  assert.equal(calls,1);
  release(old);await settle();await settle();
  assert.equal(toggle.checked,false);assert.equal(toggle.disabled,false);assert.ok(loads>=3);assert.equal(calls,1);
});
test('an empty server archive restores its empty-state message after a failed read recovers',async()=>{
  const {document}=parseHTML(html);let refresh!:()=>void, failed=false;
  mountPopup(document,{load:async()=>({settings:{accountId:'9'},recentCaptures:[],...(failed?{recentError:'SERVER_UNAVAILABLE'}:{})}),copy:async()=>{},subscribeProgress:callback=>{refresh=callback}});
  await settle();failed=true;refresh();await settle();
  assert.equal(document.querySelector<HTMLElement>('#recent-empty')!.hidden,true);
  failed=false;refresh();await settle();
  assert.equal(document.querySelector<HTMLElement>('#recent-error')!.hidden,true);
  assert.equal(document.querySelector<HTMLElement>('#recent-empty')!.hidden,false);
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

test('the synced label opens the solution in the dashboard and a finished commit opens its GitHub file', async () => {
  const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  const { document } = parseHTML(html);
  mountPopup(document, {
    load: async () => ({ settings: { accountId: '1' }, recentCaptures: [record(id, 'SYNCED', '1'), record(other, 'SYNCED', '2')] }), copy: async () => {},
    loadGithubStatuses: async () => ({ statuses: { [id]: 'SUCCEEDED', [other]: 'SUCCEEDED' },
      links: { [id]: 'https://github.com/me/archive/blob/main/SWEA/1.java', [other]: 'javascript:alert(1)' } }),
  });
  await settle(); await settle();
  const [first, second] = [...document.querySelectorAll<HTMLElement>('.recent-item')];
  const sync = first!.querySelector<HTMLAnchorElement>('a.sync-label')!;
  assert.equal(sync.getAttribute('href'), `dashboard.html?capture=${id}`); assert.equal(sync.target, '_blank'); assert.equal(sync.textContent, '동기화됨');
  assert.equal(first!.querySelector<HTMLAnchorElement>('a.recent-title')!.getAttribute('href'), `dashboard.html?capture=${id}`);
  const github = first!.querySelector<HTMLAnchorElement>('a.github-label')!;
  assert.equal(github.getAttribute('href'), 'https://github.com/me/archive/blob/main/SWEA/1.java'); assert.equal(github.textContent, 'GitHub 완료');
  assert.equal(github.rel, 'noopener noreferrer');
  // A link that is not a github.com page stays a plain label.
  assert.equal(second!.querySelector('a.github-label'), null);
  assert.equal(second!.querySelector('span.github-label')?.textContent, 'GitHub 완료');
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

test('GitHub switch shows a checking state, not a stale OFF, until settings are read', async () => {
  const { document } = parseHTML(html); let resolve!: (value: unknown) => void;
  mountPopup(document, { load: () => new Promise(done => { resolve = done; }), copy: async () => {} }); await settle();
  const toggle = document.querySelector<HTMLInputElement>('#github-auto')!;
  assert.equal(toggle.getAttribute('aria-busy'), 'true'); assert.equal(toggle.closest('.switch-row')!.classList.contains('is-checking'), true);
  resolve({ settings: { githubAutoCommitEnabled: true, relay: { status: 'CONFIRMED' } }, recentCaptures: [] }); await settle();
  assert.equal(toggle.getAttribute('aria-busy'), null); assert.equal(toggle.closest('.switch-row')!.classList.contains('is-checking'), false);
  assert.equal(toggle.checked, true); assert.equal(toggle.disabled, false);
});

test('local settings enable the GitHub switch while a cold server recent list is still pending', async () => {
  const { document } = parseHTML(html); const commands: unknown[] = []; let resolve!: (value: unknown) => void;
  const settings = { githubAutoCommitEnabled: false, githubTargetConfigured: true, accountId: '9', accountSettingsVersion: 7, relay: { status: 'CONFIRMED' } };
  mountPopup(document, { load: () => new Promise(done => { resolve = done; }), loadLocal: async () => ({ settings, pendingCount: 0 }), copy: async () => {},
    updateGithubAutomation: async command => { commands.push(command); return { ok: true, relayReady: true }; } });
  await settle();
  const toggle = document.querySelector<HTMLInputElement>('#github-auto')!;
  assert.equal(toggle.disabled, false); assert.equal(toggle.getAttribute('aria-busy'), null);
  assert.equal(document.querySelector('#automation-status')!.textContent, '서버 확인 중');
  assert.equal(document.querySelector('#recent-card')!.getAttribute('aria-busy'), 'true');
  toggle.dispatchEvent(new document.defaultView!.Event('click', { cancelable: true }));
  assert.deepEqual(commands, [{ enabled: true, accountId: '9', settingsVersion: 7 }]);
  resolve({ settings, recentCaptures: [] }); await settle();
});

test('a late local read cannot re-enable the switch after the full state read failed', async () => {
  const { document } = parseHTML(html); let resolveLocal!: (value: unknown) => void;
  mountPopup(document, { load: async () => { throw new Error('offline'); }, loadLocal: () => new Promise(done => { resolveLocal = done; }), copy: async () => {} });
  await settle();
  resolveLocal({ settings: { githubAutoCommitEnabled: true, relay: { status: 'CONFIRMED' } } }); await settle();
  const toggle = document.querySelector<HTMLInputElement>('#github-auto')!;
  assert.equal(toggle.disabled, true); assert.notEqual(toggle.checked, true);
  assert.match(document.querySelector('#error')!.textContent!, /불러오지 못했어요/);
});

test('a connected popup with temporary saves offers a manual sync and shows its result', async () => {
  const { document } = parseHTML(html);
  let pendingCount = 2, syncs = 0;
  mountPopup(document, { load: async () => ({ pendingCount, settings: { accountId: '1', autoSyncEnabled: true, relay: { status: 'CONFIRMED' } }, recentCaptures: [] }),
    copy: async () => {}, syncPending: async () => { syncs++; pendingCount = 0; return { ok: true, summary: { status: 'DONE', sent: 2, rejected: 0, remaining: 0 } }; } });
  await settle();
  const button = document.querySelector<HTMLButtonElement>('#sync-pending')!;
  assert.equal(button.hidden, false, 'shown even while the relay reports CONFIRMED');
  assert.equal(document.querySelector<HTMLButtonElement>('#retry-relay')!.hidden, true);
  button.click(); await settle(); await settle();
  assert.equal(syncs, 1);
  assert.equal(document.querySelector('#sync-pending-result')!.textContent, '2개 전송 완료');
  assert.equal(button.hidden, true, 'nothing left to send');
});
