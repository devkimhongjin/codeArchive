import type { RelayPopupState } from "./relayRuntime";

export const POPUP_RELAY_STATE_GET = "CODEARCHIVE_POPUP_RELAY_STATE_GET" as const;
export const POPUP_RELAY_LOCAL_STOP = "CODEARCHIVE_POPUP_RELAY_LOCAL_STOP" as const;

interface PopupRuntime {
  sendMessage(message: unknown, callback: (response: RelayPopupState) => void): void;
}

function runtime(): PopupRuntime | null {
  const candidate = (globalThis as { chrome?: { runtime?: PopupRuntime } }).chrome?.runtime;
  return candidate?.sendMessage ? candidate : null;
}

const unavailable: RelayPopupState = { state: "UNPAIRED", autoSyncEnabled: false };

export function requestPopupRelayState(): Promise<RelayPopupState> {
  const value = runtime();
  if (!value) return Promise.resolve(unavailable);
  return new Promise((resolve) => value.sendMessage({ type: POPUP_RELAY_STATE_GET }, (response) => resolve(response ?? unavailable)));
}

export function stopPopupRelayLocally(): Promise<RelayPopupState> {
  const value = runtime();
  if (!value) return Promise.resolve(unavailable);
  return new Promise((resolve) => value.sendMessage({ type: POPUP_RELAY_LOCAL_STOP }, (response) => resolve(response ?? unavailable)));
}
