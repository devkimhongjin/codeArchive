import assert from 'node:assert/strict';
import test from 'node:test';
import { GithubBatchTaskRunner, type GithubBatchTask } from '../src/githubBatchTask';
import { registerHistoricalOnServer } from '../src/cloudClient';
import { createCapture } from '../src/capture';
const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const target = { captureIds: ids, settingsVersion: 7, installationId: 1, owner: 'synthetic', repository: 'archive', branch: 'main' };
function storage() { let task: GithubBatchTask | null = null; return { get: async () => structuredClone(task), set: async (value: GithubBatchTask) => { task = structuredClone(value); } }; }
function fake(before?: (batch: string[]) => Promise<void>) {
  const batches: string[][] = [], known = new Set<string>();
  const fetcher = (async (url: URL, init: RequestInit) => {
    if (url.pathname === '/api/auth/me') return Response.json({ id: 1, githubId: '1' });
    if (url.pathname === '/api/auth/csrf') return Response.json({ headerName: 'X-XSRF-TOKEN', token: 'synthetic' });
    if (url.pathname === '/api/solutions/github-batch') {
      assert.equal(init.credentials, 'include');
      assert.equal((init.headers as Record<string, string>)['X-CodeArchive-Account'], '1');
      const batch = JSON.parse(init.body as string).captureIds as string[];
      batches.push(batch); await before?.(batch); batch.forEach(id => known.add(id));
      return Response.json(Object.fromEntries(batch.map(id => [id, 'PENDING'])));
    }
    return Response.json([...known].map(captureId => ({ captureId, state: 'SUCCEEDED' })));
  }) as unknown as typeof fetch;
  return { fetcher, batches };
}
test('120 selected server captures continue independently of the UI and restore completed state after a worker restart', async () => {
  const store = storage(), api = fake(), runner = new GithubBatchTaskRunner(store, api.fetcher);
  await runner.start('1:1', target); await runner.resume();
  assert.deepEqual(api.batches.map(batch => batch.length), [50, 50, 20]);
  const restarted = new GithubBatchTaskRunner(store, api.fetcher);
  assert.equal((await restarted.get('1:1'))?.status, 'DONE');
  await restarted.resume(); assert.equal(api.batches.length, 3);
  assert.equal(await restarted.get('2:2'), null);
  assert.equal('sourceCode' in (await store.get())!, false);
});
test('cancel waits for the current request but stops remaining batches', async () => {
  const store = storage(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = fake(async () => { entered(); await gate; });
  const runner = new GithubBatchTaskRunner(store, api.fetcher);
  await runner.start('1:1', target); await started; await runner.cancel('1:1'); release(); await runner.resume();
  assert.equal(api.batches.length, 1); assert.equal((await runner.get('1:1'))?.offset, 50);
});
test('restored pending requests stop under another signed-in account', async () => {
  const store = storage(); await store.set({ ...target, account: '1:1', taskId: 'test', status: 'REQUESTING', offset: 50, states: {}, cancelRequested: false, updatedAt: 1 });
  const runner = new GithubBatchTaskRunner(store, (async () => Response.json({ id: 2, githubId: '2' })) as typeof fetch);
  await runner.resume(); assert.equal((await runner.get('1:1'))?.status, 'PAUSED');
});
test('cancellation overlapping a delayed progress write stays set and never rolls back acknowledged progress', async () => {
  const base = storage(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const offsets: number[] = [];
  let delayed = false;
  const store = { get: base.get, set: async (task: GithubBatchTask) => {
    if (task.offset === 50 && !task.cancelRequested && !delayed) { delayed = true; entered(); await gate; }
    offsets.push(task.offset); await base.set(task);
  } };
  const api = fake(), runner = new GithubBatchTaskRunner(store, api.fetcher);
  await runner.start('1:1', target); await started;
  const cancelling = runner.cancel('1:1');
  await new Promise<void>(resolve => setImmediate(resolve));
  release(); await cancelling; await runner.resume();
  const task = await runner.get('1:1');
  assert.equal(api.batches.length, 1);
  assert.equal(task?.cancelRequested, true);
  assert.equal(task?.offset, 50);
  assert.ok(offsets.every((value, i) => i === 0 || value >= offsets[i - 1]!));
});
test('concurrent starts cannot replace an already accepted task', async () => {
  const store = storage(), api = fake(), runner = new GithubBatchTaskRunner(store, api.fetcher);
  const first = runner.start('1:1', target);
  await assert.rejects(runner.start('1:1', { ...target, captureIds: ids.slice(1) }), /진행 중/);
  await first; await runner.resume(); assert.equal((await runner.get('1:1'))?.captureIds.length, 120);
});
test('a paused task with stale target settings can be cancelled before starting a new explicit selection', async () => {
  const store = storage(), api = fake(), runner = new GithubBatchTaskRunner(store, api.fetcher);
  await store.set({ ...target, account: '1:1', taskId: 'test', status: 'PAUSED', offset: 0, states: {}, cancelRequested: false, updatedAt: 1 });
  await runner.cancel('1:1'); await runner.start('1:1', { ...target, settingsVersion: 8, captureIds: ids.slice(0,1) }); await runner.resume();
  assert.equal((await runner.get('1:1'))?.status, 'DONE');
});
test('a stale popup task identifier cannot cancel or resume a replacement task', async () => {
  const base=storage(), value={...target,account:'1:1',taskId:'new',status:'PAUSED' as const,offset:0,states:{},cancelRequested:false,updatedAt:1};
  await base.set(value);let fetches=0;
  const runner=new GithubBatchTaskRunner(base,(async()=>{fetches++;throw new Error('not expected')}) as typeof fetch);
  assert.equal(await runner.cancel('1:1','old'),false);assert.equal(await runner.retry('1:1','old'),false);
  assert.deepEqual(await base.get(),value);assert.equal(fetches,0);
  let first=true;
  const raced=new GithubBatchTaskRunner({set:base.set,get:async()=>{const observed=await base.get();if(first){first=false;await base.set({...value,taskId:'replacement'})}return observed}},fake().fetcher);
  assert.equal(await raced.cancel('1:1','new'),false);
  assert.equal((await base.get())?.taskId,'replacement');assert.equal((await base.get())?.cancelRequested,false);
});
test('popup resume leaves a paused task untouched when its cloud account changes during verification', async () => {
  const store=storage(), task={...target,account:'1:1',taskId:'paused',status:'PAUSED' as const,offset:0,states:{},cancelRequested:false,updatedAt:1};
  await store.set(task);
  let release!:(response:Response)=>void, entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve});
  const account=new Promise<Response>(resolve=>{release=resolve});
  const paths:string[]=[];
  const runner=new GithubBatchTaskRunner(store,(async(url:URL)=>{paths.push(url.pathname);entered();return account}) as typeof fetch);
  const retry=runner.retry('1:1','paused');
  await started;release(Response.json({id:2,githubId:'2'}));
  await assert.rejects(retry);
  assert.deepEqual(await store.get(),task);
  assert.deepEqual(paths,['/api/auth/me']);
});
test('historical registration compares server membership and does not require an IndexedDB capture', async () => {
  const capture = createCapture({ platform: 'JUNGOL', problemNumber: '1', title: 'T', language: 'Java', problemUrl: 'https://jungol.co.kr/problem/1', sourceCode: 'class X{}',
    result: 'ACCEPTED', historicalImport: true, historicalSubmissionId: '101', solvedAt: '2026-10-12T00:00:00.000Z', observedAt: '2026-10-12T00:00:00.000Z' })!;
  let uploadCount = 0;
  const fetcher = (async (url: URL) => { if (url.pathname.endsWith('/me')) return Response.json({ id: 1, githubId: '1' }); if (url.pathname.endsWith('historical-submission-ids')) return Response.json(['101']); uploadCount++; return Response.json({}); }) as unknown as typeof fetch;
  assert.deepEqual(await registerHistoricalOnServer(capture, '1:1', fetcher), { ok: true, created: false }); assert.equal(uploadCount, 0);
});

function settling(plan: (poll: number, index: number) => 'PENDING' | 'RUNNING' | 'SUCCEEDED') {
  let polls = 0;
  const known: string[] = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    if (url.pathname === '/api/auth/me') return Response.json({ id: 1, githubId: '1' });
    if (url.pathname === '/api/auth/csrf') return Response.json({ headerName: 'X-XSRF-TOKEN', token: 'synthetic' });
    if (url.pathname === '/api/solutions/github-batch') {
      const batch = JSON.parse(init.body as string).captureIds as string[];
      known.push(...batch);
      return Response.json(Object.fromEntries(batch.map(id => [id, 'PENDING'])));
    }
    polls += 1;
    return Response.json(known.map((captureId, index) => ({ captureId, state: plan(polls, index) })));
  }) as unknown as typeof fetch;
  return { fetcher, polls: () => polls };
}
function ticking(windowMs = 60_000) {
  let clock = 0; const slept: number[] = [];
  return { slept, tracking: { intervalMs: 1_000, windowMs, now: () => clock, sleep: async (ms: number) => { slept.push(ms); clock += ms; } } };
}

test('after every commit is requested the runner looks again every few seconds and stores each look for the popup', async () => {
  const base = storage(), successes: number[] = [];
  const store = { get: base.get, set: async (task: GithubBatchTask) => { successes.push(Object.values(task.states).filter(state => state === 'SUCCEEDED').length); await base.set(task); } };
  const api = settling((poll, index) => poll === 1 ? (index < 30 ? 'SUCCEEDED' : 'PENDING') : poll === 2 ? (index < 80 ? 'SUCCEEDED' : 'RUNNING') : 'SUCCEEDED');
  const clock = ticking(), runner = new GithubBatchTaskRunner(store, api.fetcher, clock.tracking);
  await runner.start('1:1', target); await runner.resume();
  assert.equal(api.polls(), 3, 'one look per interval until nothing is pending or running');
  assert.deepEqual(clock.slept, [1_000, 1_000]);
  assert.deepEqual([...new Set(successes)].filter(count => [30, 80, 120].includes(count)), [30, 80, 120], 'each look is stored before the next one');
  const done = (await runner.get('1:1'))!;
  assert.equal(done.status, 'DONE');
  assert.equal(Object.values(done.states).filter(state => state === 'SUCCEEDED').length, 120);
});

test('tracking that outlasts its window stays open for the next alarm instead of looping forever', async () => {
  let settled = false;
  const store = storage(), api = settling(() => settled ? 'SUCCEEDED' : 'PENDING');
  const clock = ticking(3_000), runner = new GithubBatchTaskRunner(store, api.fetcher, clock.tracking);
  await runner.start('1:1', target); await runner.resume();
  assert.equal(api.polls(), 4, 'looks at 0s, 1s, 2s and 3s, then hands over');
  assert.equal((await runner.get('1:1'))?.status, 'TRACKING');
  settled = true; await runner.resume();
  assert.equal((await runner.get('1:1'))?.status, 'DONE');
});

test('tracking stops quietly when another task replaces the one it was following', async () => {
  const store = storage(), api = settling(() => 'PENDING'), clock = ticking();
  const replacement = { ...target, captureIds: [ids[0]!], account: '1:1', taskId: 'replacement', status: 'REQUESTING' as const, offset: 0, states: {}, cancelRequested: false, updatedAt: 1 };
  const tracking = { ...clock.tracking, sleep: async (ms: number) => { await clock.tracking.sleep(ms); await store.set(replacement); } };
  const runner = new GithubBatchTaskRunner(store, api.fetcher, tracking);
  await runner.start('1:1', target); await runner.resume();
  assert.equal(api.polls(), 1);
  const kept = (await store.get())!;
  assert.equal(kept.taskId, 'replacement');
  assert.equal(kept.status, 'REQUESTING', 'the replacement is left exactly as it was');
});
