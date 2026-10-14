import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountPopup } from '../src/popupView';
import { loadPopupBatchProgress, projectPopupBatchProgress } from '../src/popupBatchProgress';
import type { CaptureSettings } from '../src/types';
import type { GithubBatchTask } from '../src/githubBatchTask';
const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const settings = { accountId:'1', autoSyncEnabled:true, relay:{ accountId:'1', generation:7, secret:'synthetic', status:'CONFIRMED' } } as CaptureSettings;
const task = { taskId:'synthetic', account:'1:123', captureIds:ids, settingsVersion:7, installationId:1, owner:'synthetic', repository:'fixture', branch:'main', status:'TRACKING', offset:4, states:{ [ids[0]!]: 'SUCCEEDED', [ids[1]!]: 'FAILED', [ids[2]!]: 'UNKNOWN', [ids[3]!]: 'PENDING' }, cancelRequested:false, updatedAt:0 } as GithubBatchTask;
test('projects current account counts only and excludes foreign/revoked/malformed tasks', () => {
  const progress = projectPopupBatchProgress(task, settings)!;
  assert.equal(progress.processed,3); assert.equal(progress.total,4); assert.equal(progress.completed,1);
  assert.equal('captureIds' in progress,false); assert.equal('owner' in progress,false); assert.equal('secret' in progress,false);
  for(const invalid of [{ ...task, account:'2:123' }, { ...task, states:{ other:'SUCCEEDED' } }, { ...task, offset:5 }]) assert.equal(projectPopupBatchProgress(invalid,settings),null);
  assert.equal(projectPopupBatchProgress(task,{ ...settings,autoSyncEnabled:false }),null);
  assert.equal(projectPopupBatchProgress(task,{ ...settings,relay:{ ...settings.relay!,status:'REVOCATION_PENDING' } }),null);
});
test('drops a task read crossing account or grant changes', async () => {
  let current = settings;
  assert.equal(await loadPopupBatchProgress({getSettings:async()=>current},async()=>{current={...settings,accountId:'2'};return task}),null);
});
test('shows independently of a slow recent-server read and restores on popup reopen', async () => {
  for(let reopen=0;reopen<2;reopen++) {
    const { document } = parseHTML(readFileSync(new URL('../src/popup.html',import.meta.url),'utf8'));
    let refresh!:()=>void, value=projectPopupBatchProgress(task,settings);
    mountPopup(document,{load:()=>new Promise(()=>{}),copy:async()=>{},loadBatchProgress:async()=>({progress:value}),subscribeProgress:callback=>{refresh=callback}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(document.getElementById('github-batch-card')!.hidden,false);
    assert.match(document.getElementById('github-batch-counts')!.textContent!,/3\/4건 \(75%\)/);
    assert.match(document.getElementById('github-batch-detail')!.textContent!,/성공 1건 · 실패 1건 · 확인 필요 1건/);
    value=projectPopupBatchProgress({...task,status:'DONE',states:Object.fromEntries(ids.map(id=>[id,'SUCCEEDED']))},settings);refresh();
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(document.getElementById('github-batch-counts')!.textContent!,/4\/4건 \(100%\)/);
    assert.equal(document.getElementById('github-batch-state')!.textContent,'처리 완료');
  }
});
