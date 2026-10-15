import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountPopup } from '../src/popupView';
import { actOnPopupBatch, loadPopupBatchProgress, projectPopupBatchProgress } from '../src/popupBatchProgress';
import type { CaptureSettings } from '../src/types';
import type { GithubBatchTask } from '../src/githubBatchTask';
const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const settings = { accountId:'1', autoSyncEnabled:true, relay:{ accountId:'1', generation:7, secret:'synthetic', status:'CONFIRMED' } } as CaptureSettings;
const task = { taskId:'synthetic', account:'1:123', captureIds:ids, settingsVersion:7, installationId:1, owner:'synthetic', repository:'fixture', branch:'main', status:'TRACKING', offset:4, states:{ [ids[0]!]: 'SUCCEEDED', [ids[1]!]: 'FAILED', [ids[2]!]: 'UNKNOWN', [ids[3]!]: 'PENDING' }, cancelRequested:false, updatedAt:0 } as GithubBatchTask;
test('projects current account counts only and excludes foreign/malformed tasks', () => {
  const progress = projectPopupBatchProgress(task, settings)!;
  assert.equal(progress.processed,3); assert.equal(progress.total,4); assert.equal(progress.completed,1);
  assert.equal('captureIds' in progress,false); assert.equal('owner' in progress,false); assert.equal('secret' in progress,false);
  for(const invalid of [{ ...task, account:'2:123' }, { ...task, states:{ other:'SUCCEEDED' } }, { ...task, offset:5 }]) assert.equal(projectPopupBatchProgress(invalid,settings),null);
  assert.equal(projectPopupBatchProgress(task,{ ...settings,accountId:undefined }),null);
});
test('manual batch counts and controls remain available without automatic synchronization or a usable relay', async () => {
  const configurations: CaptureSettings[] = [
    { ...settings, autoSyncEnabled:false },
    { ...settings, relay:undefined },
    { ...settings, relay:{ ...settings.relay!, status:'AUTH_EXPIRED' } },
    { ...settings, autoSyncEnabled:false, relay:{ ...settings.relay!, status:'REVOCATION_PENDING' } },
  ];
  for (const configuration of configurations) {
    assert.equal(projectPopupBatchProgress(task,configuration)?.processed,3);
    const calls: string[]=[];
    const runner={cancel:async(account:string,id:string)=>{calls.push(`cancel:${account}:${id}`);return true},retry:async(account:string,id:string)=>{calls.push(`retry:${account}:${id}`);return true}};
    const store={getSettings:async()=>configuration};
    assert.equal((await actOnPopupBatch(store,async()=>task,runner,{action:'CANCEL',accountId:'1',taskId:task.taskId})).ok,true);
    assert.equal((await actOnPopupBatch(store,async()=>({...task,status:'PAUSED'}),runner,{action:'RESUME',accountId:'1',taskId:task.taskId})).ok,true);
    assert.deepEqual(calls,[`cancel:1:123:${task.taskId}`,`retry:1:123:${task.taskId}`]);
  }
});
test('drops a task read crossing account or grant changes', async () => {
  let current = settings;
  assert.equal(await loadPopupBatchProgress({getSettings:async()=>current},async()=>{current={...settings,accountId:'2'};return task}),null);
  current=settings;
  const runner={cancel:async()=>{throw new Error('stale account must not cancel')},retry:async()=>{throw new Error('stale account must not resume')}};
  assert.equal((await actOnPopupBatch({getSettings:async()=>current},async()=>{current={...settings,accountId:'2'};return task},runner,{action:'CANCEL',accountId:'1',taskId:task.taskId})).ok,false);
});
test('popup actions use only the current account and displayed task, and require a paused task to resume', async () => {
  const calls: string[]=[];
  const runner={cancel:async(account:string,id:string)=>{calls.push(`cancel:${account}:${id}`);return true},retry:async(account:string,id:string)=>{calls.push(`retry:${account}:${id}`);return true}};
  const store={getSettings:async()=>settings};
  for(const command of [{action:'CANCEL' as const,accountId:'2',taskId:task.taskId},{action:'CANCEL' as const,accountId:'1',taskId:'old'},{action:'RESUME' as const,accountId:'1',taskId:task.taskId}]) {
    assert.equal((await actOnPopupBatch(store,async()=>task,runner,command)).ok,false);
  }
  assert.equal(calls.length,0);
  assert.equal((await actOnPopupBatch(store,async()=>task,runner,{action:'CANCEL',accountId:'1',taskId:task.taskId})).ok,true);
  assert.equal((await actOnPopupBatch(store,async()=>({...task,status:'PAUSED'}),runner,{action:'RESUME',accountId:'1',taskId:task.taskId})).ok,true);
  assert.deepEqual(calls,[`cancel:1:123:${task.taskId}`,`retry:1:123:${task.taskId}`]);
});
test('paused controls coalesce clicks and retain completed counts with controls hidden until popup reload', async () => {
  const {document}=parseHTML(readFileSync(new URL('../src/popup.html',import.meta.url),'utf8'));
  let value=projectPopupBatchProgress({...task,status:'PAUSED'},settings), release!:()=>void, calls=0;
  const gate=new Promise<void>(resolve=>{release=resolve});
  mountPopup(document,{load:()=>new Promise(()=>{}),copy:async()=>{},loadBatchProgress:async()=>({progress:value}),batchAction:async command=>{
    calls++;assert.deepEqual(command,{action:'RESUME',accountId:'1',taskId:task.taskId});await gate;
    value=projectPopupBatchProgress({...task,status:'DONE',states:Object.fromEntries(ids.map(id=>[id,'SUCCEEDED']))},settings);return {ok:true};
  }});
  await new Promise(resolve=>setImmediate(resolve));
  const resume=document.getElementById('github-batch-resume') as HTMLButtonElement;
  assert.equal(resume.hidden,false);resume.click();resume.click();assert.equal(calls,1);assert.equal(resume.disabled,true);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('github-batch-card')!.hidden,false);
  assert.equal(resume.hidden,true);assert.equal(document.getElementById('github-batch-cancel')!.hidden,true);
  assert.equal(document.getElementById('github-batch-state')!.textContent,'처리 완료');
  assert.match(document.getElementById('github-batch-detail')!.textContent!,/성공 4건 · 실패 0건 · 확인 필요 0건/);
});
test('reopening a popup never shows a completed batch while other popup features remain visible', async () => {
  const {document}=parseHTML(readFileSync(new URL('../src/popup.html',import.meta.url),'utf8'));
  mountPopup(document,{load:()=>new Promise(()=>{}),copy:async()=>{},loadBatchProgress:async()=>({progress:projectPopupBatchProgress({...task,status:'DONE'},settings)})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('github-batch-card')!.hidden,true);
  assert.equal(document.getElementById('popup-content')!.hidden,false);
  assert.equal(document.getElementById('recent-card')!.hidden,false);
});
test('completed success, failure and unknown counts survive automatic polling until a new popup session', async () => {
  const markup=readFileSync(new URL('../src/popup.html',import.meta.url),'utf8');
  const {document}=parseHTML(markup);
  let refresh!:()=>void, value=projectPopupBatchProgress(task,settings);
  mountPopup(document,{load:()=>new Promise(()=>{}),copy:async()=>{},loadBatchProgress:async()=>({progress:value}),subscribeProgress:callback=>{refresh=callback}});
  await new Promise(resolve=>setImmediate(resolve));
  value=projectPopupBatchProgress({...task,status:'DONE',states:{[ids[0]!]: 'SUCCEEDED',[ids[1]!]: 'FAILED',[ids[2]!]: 'UNKNOWN',[ids[3]!]: 'UNKNOWN'}},settings);
  for(let poll=0;poll<2;poll++) {
    refresh();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(document.getElementById('github-batch-card')!.hidden,false);
    assert.match(document.getElementById('github-batch-detail')!.textContent!,/성공 1건 · 실패 1건 · 확인 필요 2건/);
  }
  const reopened=parseHTML(markup).document;
  mountPopup(reopened,{load:()=>new Promise(()=>{}),copy:async()=>{},loadBatchProgress:async()=>({progress:value})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reopened.getElementById('github-batch-card')!.hidden,true);
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
    assert.equal(document.getElementById('github-batch-card')!.hidden,false);
    assert.match(document.getElementById('github-batch-counts')!.textContent!,/4\/4건 \(100%\)/);
    assert.equal(document.getElementById('github-batch-state')!.textContent,'처리 완료');
  }
});
