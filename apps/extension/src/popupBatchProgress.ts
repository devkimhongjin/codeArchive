import type { CaptureSettings } from './types';
import { validBatchTarget, type GithubBatchTask } from './githubBatchTask';

export type PopupBatchProgress = {
  accountId: string; taskId: string; status: GithubBatchTask['status']; total: number; requested: number;
  completed: number; failed: number; unknown: number; processed: number; cancelRequested: boolean;
};
export type PopupBatchAction = { action: 'CANCEL' | 'RESUME'; taskId: string; accountId: string };
/** Project counts only. The popup never receives source, targets or capture IDs. */
export function projectPopupBatchProgress(value: unknown, settings: CaptureSettings): PopupBatchProgress | null {
  // Manual batch jobs remain manageable when automatic synchronization is off or
  // its relay expires. Retry separately verifies the signed-in cloud account.
  if (!settings.accountId || !/^[1-9]\d{0,15}$/.test(settings.accountId) || !validBatchTarget(value)) return null;
  const task = value as GithubBatchTask;
  if (!/^\d+:\d+$/.test(task.account ?? '') || task.account.split(':')[0] !== settings.accountId ||
    typeof task.taskId !== 'string' || !['REQUESTING', 'TRACKING', 'DONE', 'PAUSED'].includes(task.status) ||
    !Number.isSafeInteger(task.offset) || task.offset < 0 || task.offset > task.captureIds.length ||
    !task.states || typeof task.states !== 'object' || typeof task.cancelRequested !== 'boolean') return null;
  const selected = new Set(task.captureIds);
  if (Object.entries(task.states).some(([id, state]) => !selected.has(id) || !['NONE','PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN'].includes(state))) return null;
  const state = Object.values(task.states);
  const completed = state.filter(value => value === 'SUCCEEDED').length, failed = state.filter(value => value === 'FAILED').length, unknown = state.filter(value => value === 'UNKNOWN').length;
  return { accountId: settings.accountId, taskId: task.taskId, status: task.status, total: task.captureIds.length, requested: task.offset,
    completed, failed, unknown, processed: completed + failed + unknown, cancelRequested: task.cancelRequested };
}
export async function loadPopupBatchProgress(store: { getSettings(): Promise<CaptureSettings> }, read: () => Promise<unknown>): Promise<PopupBatchProgress | null> {
  const before = await store.getSettings();
  const value = await read();
  const after = await store.getSettings();
  if (before.accountId !== after.accountId || before.autoSyncEnabled !== after.autoSyncEnabled || before.relay?.secret !== after.relay?.secret || before.relay?.generation !== after.relay?.generation || before.relay?.status !== after.relay?.status) return null;
  return projectPopupBatchProgress(value, after);
}
export async function actOnPopupBatch(store: { getSettings(): Promise<CaptureSettings> }, read: () => Promise<unknown>,
  runner: { cancel(account: string, expectedTaskId: string): Promise<boolean>; retry(account: string, expectedTaskId: string): Promise<boolean> }, command: PopupBatchAction) {
  let task: unknown;
  const progress = await loadPopupBatchProgress(store, async () => task = await read());
  if (!progress || progress.accountId !== command.accountId || progress.taskId !== command.taskId || progress.status === 'DONE' ||
    (command.action === 'RESUME' && progress.status !== 'PAUSED') || (command.action === 'CANCEL' && progress.cancelRequested)) return { ok: false, error: 'TASK_CHANGED' };
  const account = (task as GithubBatchTask).account;
  const ok = command.action === 'CANCEL' ? await runner.cancel(account, command.taskId) : await runner.retry(account, command.taskId);
  return ok ? { ok: true } : { ok: false, error: 'TASK_CHANGED' };
}
