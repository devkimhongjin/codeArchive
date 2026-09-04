import { markDurableLocalSourceStopped } from "./durableAutomationState";

type ExplicitAutoSyncOffHandler = () => Promise<void> | void;

let handler: ExplicitAutoSyncOffHandler | null = null;

export function registerExplicitAutoSyncOffHandler(next: ExplicitAutoSyncOffHandler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export async function notifyExplicitAutoSyncOff(): Promise<void> {
  markDurableLocalSourceStopped();
  try { await handler?.(); } catch { /* Local consent OFF remains authoritative even while server revoke is pending. */ }
}
