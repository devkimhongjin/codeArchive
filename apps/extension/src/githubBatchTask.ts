import { cloudRequest, confirmCloudAccount } from './cloudClient';

export type BatchTarget = { captureIds: string[]; settingsVersion: number; installationId: number; owner: string; repository: string; branch: string };
export type BatchState = 'NONE' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type GithubBatchTask = BatchTarget & { taskId: string; account: string; status: 'REQUESTING' | 'TRACKING' | 'DONE' | 'PAUSED';
  offset: number; states: Record<string, BatchState>; cancelRequested: boolean; error?: string; updatedAt: number };
export type BatchTaskStorage = { get(): Promise<GithubBatchTask | null>; set(value: GithubBatchTask): Promise<void> };
const states: BatchState[] = ['NONE', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'];
export function validBatchTarget(value: unknown): value is BatchTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as BatchTarget;
  return Array.isArray(target.captureIds) && target.captureIds.length > 0 && target.captureIds.length <= 5000 &&
    target.captureIds.every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) &&
    new Set(target.captureIds).size === target.captureIds.length && Number.isSafeInteger(target.settingsVersion) && target.settingsVersion >= 0 &&
    Number.isSafeInteger(target.installationId) && target.installationId > 0 && ['owner', 'repository', 'branch'].every(key => typeof target[key as 'owner'] === 'string' && target[key as 'owner'].length > 0 && target[key as 'owner'].length <= 255);
}
/** Persists only account-bound job metadata; code and credentials are never stored here. */
export class GithubBatchTaskRunner {
  private work: Promise<void> | null = null;
  private starting = false;
  private mutations: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: BatchTaskStorage, private readonly fetcher: typeof fetch = fetch) {}
  private update(change: (latest: GithubBatchTask | null) => GithubBatchTask | null): Promise<GithubBatchTask | null> {
    const pending = this.mutations.then(async () => {
      const next = change(await this.storage.get());
      if (next) await this.storage.set(next);
      return next;
    });
    this.mutations = pending.catch(() => undefined);
    return pending;
  }
  async start(account: string, target: BatchTarget): Promise<GithubBatchTask> {
    if (this.starting || this.work) throw new Error('진행 중인 일괄 커밋을 먼저 확인해 주세요.');
    this.starting = true;
    try {
    if (!validBatchTarget(target)) throw new Error('커밋 대상을 확인하지 못했습니다.');
    await confirmCloudAccount(account, this.fetcher);
    const task = await this.update(existing => {
    if (this.work) throw new Error('진행 중인 일괄 커밋을 먼저 확인해 주세요.');
    if (existing && existing.account === account && ['REQUESTING', 'TRACKING', 'PAUSED'].includes(existing.status) && !(existing.status === 'PAUSED' && existing.cancelRequested)) throw new Error('진행 중인 일괄 커밋을 먼저 확인해 주세요.');
    return { ...target, captureIds: [...target.captureIds], taskId: crypto.randomUUID(), account, status: 'REQUESTING', offset: 0, states: {}, cancelRequested: false, updatedAt: Date.now() };
    });
    void this.resume(); return task!;
    } finally { this.starting = false; }
  }
  async get(account: string): Promise<GithubBatchTask | null> { const task = await this.storage.get(); return task?.account === account ? task : null; }
  async cancel(account: string) {
    const observed = await this.get(account);
    if (!observed) return;
    await this.update(task => {
      if (!task || task.account !== account || task.taskId !== observed.taskId) return null;
      task.cancelRequested = true;
      if (task.status === 'PAUSED') task.status = task.offset ? 'TRACKING' : 'DONE';
      task.updatedAt = Date.now(); return task;
    });
  }
  async retry(account: string) {
    const observed = await this.get(account);
    if (!observed || observed.status !== 'PAUSED') return;
    await confirmCloudAccount(account, this.fetcher);
    const changed = await this.update(task => {
      if (!task || task.account !== account || task.taskId !== observed.taskId || task.status !== 'PAUSED') return null;
      task.status = task.offset < task.captureIds.length && !task.cancelRequested ? 'REQUESTING' : 'TRACKING';
      delete task.error; task.updatedAt = Date.now(); return task;
    });
    if (changed) void this.resume();
  }
  async resume(): Promise<void> {
    if (this.work) return this.work;
    this.work = this.run().finally(() => { this.work = null; }); return this.work;
  }
  private async run() {
    let task = await this.storage.get();
    if (!task || task.status === 'DONE' || task.status === 'PAUSED') return;
    const persist = async () => {
      task = (await this.update(latest => {
        if (!latest || latest.taskId !== task!.taskId) throw new Error('작업이 변경되었습니다.');
        return { ...task!, offset: Math.max(latest.offset, task!.offset), states: { ...latest.states, ...task!.states },
          cancelRequested: latest.cancelRequested || task!.cancelRequested, updatedAt: Date.now() };
      }))!;
    };
    try {
      const user = await confirmCloudAccount(task.account, this.fetcher);
      while (task.offset < task.captureIds.length && !task.cancelRequested) {
        await confirmCloudAccount(task.account, this.fetcher);
        const latest = await this.storage.get();
        if (latest?.taskId !== task.taskId) throw new Error('작업이 변경되었습니다.');
        task.cancelRequested ||= latest.cancelRequested;
        if (task.cancelRequested) break;
        const batch = task.captureIds.slice(task.offset, task.offset + 50);
        const result = await cloudRequest<Record<string, BatchState>>('/api/solutions/github-batch', user.githubId, {
          captureIds: batch, settingsVersion: task.settingsVersion, installationId: task.installationId, owner: task.owner, repository: task.repository, branch: task.branch,
        }, this.fetcher);
        if (!result || Object.keys(result).length !== batch.length || batch.some(id => !Object.prototype.hasOwnProperty.call(result, id) || !states.includes(result[id]!))) throw new Error('서버 커밋 접수 결과를 확인하지 못했습니다.');
        Object.assign(task.states, result); task.offset += batch.length; await persist();
      }
      task.status = 'TRACKING'; await persist();
      if (task.offset) {
        const candidates = await cloudRequest<{ captureId: string; state: BatchState }[]>('/api/solutions/github-candidates', user.githubId, undefined, this.fetcher);
        if (!Array.isArray(candidates)) throw new Error('커밋 상태를 확인하지 못했습니다.');
        for (const id of task.captureIds.slice(0, task.offset)) {
          const record = candidates.find(row => row.captureId === id);
          if (!record || !states.includes(record.state) || record.state === 'NONE') throw new Error('서버 커밋 상태를 확인하지 못했습니다.');
          task.states[id] = record.state;
        }
      }
      if (!Object.values(task.states).some(state => state === 'PENDING' || state === 'RUNNING')) task.status = 'DONE';
      await persist();
    } catch (error) { task.status = 'PAUSED'; task.error = error instanceof Error ? error.message : '일괄 커밋을 이어가지 못했습니다.'; await persist(); }
  }
}
