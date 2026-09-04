type ExplicitAutoSyncOffHandler = () => Promise<void> | void;

let handler: ExplicitAutoSyncOffHandler | null = null;

export function registerExplicitAutoSyncOffHandler(next: ExplicitAutoSyncOffHandler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export async function notifyExplicitAutoSyncOff(): Promise<void> {
  await handler?.();
}
