import { markDurableLocalSourceStopped } from "./durableAutomationState";

type ExplicitAutoSyncOffHandler = () => Promise<boolean | void> | boolean | void;

let handler: ExplicitAutoSyncOffHandler | null = null;

export function registerExplicitAutoSyncOffHandler(next: ExplicitAutoSyncOffHandler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export async function notifyExplicitAutoSyncOff(): Promise<boolean> {
  markDurableLocalSourceStopped();
  if (!handler) return false;
  try { return (await handler()) !== false; }
  catch { return false; /* Local consent OFF remains authoritative even while server revoke is pending. */ }
}
