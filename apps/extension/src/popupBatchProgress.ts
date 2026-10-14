import type { CaptureSettings } from './types';
import { validBatchTarget, type GithubBatchTask } from './githubBatchTask';

export type PopupBatchProgress = {
  accountId: string; taskId: string; status: GithubBatchTask['status']; total: number; requested: number;
  completed: number; failed: number; unknown: number; processed: number; cancelRequested: boolean;
};
/** Project counts only. The popup never receives source, targets or capture IDs. */
export function projectPopupBatchProgress(value: unknown, settings: CaptureSettings): PopupBatchProgress | null {
  if (!settings.accountId || settings.autoSyncEnabled !== true || settings.relay?.accountId !== settings.accountId ||
    settings.relay.status === 'REVOCATION_PENDING' || settings.relay.status === 'AUTH_EXPIRED' || !validBatchTarget(value)) return null;
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
