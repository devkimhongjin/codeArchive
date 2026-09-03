import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  type CodeArchiveAutomationControlErrorCode,
  type CodeArchiveAutomationKind,
  type CodeArchiveAutomationState,
  type CodeArchiveAutomationStateUpdateEvent,
} from "../../../packages/shared-types/src";

export const POPUP_AUTOMATION_STATE_GET = "CODEARCHIVE_POPUP_AUTOMATION_STATE_GET" as const;
export const POPUP_AUTOMATION_SET = "CODEARCHIVE_POPUP_AUTOMATION_SET" as const;

const STATE_WAIT_MS = 750;

export interface AutomationPort {
  postMessage(message: unknown): void;
}

export interface PopupAutomationStateResponse {
  readonly state: CodeArchiveAutomationState;
  readonly forwarded: boolean;
}

export interface PopupAutomationSetResponse extends PopupAutomationStateResponse {
  readonly accepted: boolean;
}

export interface PopupAutomationStateGetMessage {
  readonly type: typeof POPUP_AUTOMATION_STATE_GET;
}

export interface PopupAutomationSetMessage {
  readonly type: typeof POPUP_AUTOMATION_SET;
  readonly automation: CodeArchiveAutomationKind;
  readonly enabled: boolean;
}

export type PopupAutomationMessage = PopupAutomationStateGetMessage | PopupAutomationSetMessage;

export function unavailableAutomationState(errorCode: CodeArchiveAutomationControlErrorCode = "CONTROL_UNAVAILABLE"): CodeArchiveAutomationState {
  return {
    protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
    autoSyncEnabled: false,
    githubAutoCommitEnabled: false,
    githubTargetConfigured: false,
    authenticated: false,
    connectionAvailable: false,
    errorCode,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isErrorCode(value: unknown): value is CodeArchiveAutomationControlErrorCode | null {
  return value === null || [
    "AUTH_REQUIRED",
    "DASHBOARD_DISCONNECTED",
    "MULTIPLE_DASHBOARD_TABS",
    "AUTO_SYNC_CONSENT_REQUIRED",
    "GITHUB_TARGET_REQUIRED",
    "GITHUB_CONSENT_REQUIRED",
    "PUBLIC_REPOSITORY_CONSENT_REQUIRED",
    "OFFLINE",
    "LEASE_FAILED",
    "GITHUB_TARGET_CHANGED",
    "GITHUB_OUTCOME_UNKNOWN",
    "CONTROL_UNAVAILABLE",
  ].includes(value as string);
}

function parseStateUpdate(value: unknown): CodeArchiveAutomationStateUpdateEvent | null {
  if (!isObject(value) || value.type !== "CODEARCHIVE_AUTOMATION_STATE_UPDATE" || value.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION || !isObject(value.state)) return null;
  if (!hasExactlyKeys(value, ["type", "protocolVersion", "state"])) return null;
  const state = value.state;
  if (!hasExactlyKeys(state, ["protocolVersion", "autoSyncEnabled", "githubAutoCommitEnabled", "githubTargetConfigured", "authenticated", "connectionAvailable", "errorCode"])) return null;
  if (state.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION) return null;
  if (!["autoSyncEnabled", "githubAutoCommitEnabled", "githubTargetConfigured", "authenticated", "connectionAvailable"].every((key) => typeof state[key] === "boolean")) return null;
  if (!isErrorCode(state.errorCode)) return null;
  return value as unknown as CodeArchiveAutomationStateUpdateEvent;
}

interface StateWaiter {
  readonly resolve: (response: PopupAutomationStateResponse) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class AutomationControlController {
  private readonly ports = new Set<AutomationPort>();
  private readonly waiters = new Set<StateWaiter>();
  private state = unavailableAutomationState();
  private multipleDashboardTabsLatched = false;

  constructor(private readonly onMultipleDashboardTabs: () => void = () => undefined) {}

  connect(port: AutomationPort): void {
    this.ports.add(port);
    if (this.ports.size >= 2) this.enterMultipleDashboardTabsSafetyStop();
  }

  disconnect(port: AutomationPort): void {
    this.ports.delete(port);
    if (this.ports.size === 0) this.replaceState(unavailableAutomationState("DASHBOARD_DISCONNECTED"));
  }

  activePortCount(): number {
    return this.ports.size;
  }

  getState(): CodeArchiveAutomationState {
    return { ...this.state };
  }

  requestState(): Promise<PopupAutomationStateResponse> {
    const port = this.eligiblePort();
    if (!port) return Promise.resolve({ state: this.getState(), forwarded: false });
    port.postMessage({ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION });
    return this.waitForState(true);
  }

  setAutomation(automation: CodeArchiveAutomationKind, enabled: boolean): Promise<PopupAutomationSetResponse> {
    const port = this.eligiblePort();
    if (!port) return Promise.resolve({ accepted: false, state: this.getState(), forwarded: false });
    port.postMessage({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION, automation, enabled });
    return this.waitForState(true).then((response) => ({ accepted: true, ...response }));
  }

  receive(port: AutomationPort, value: unknown): boolean {
    const parsed = parseStateUpdate(value);
    if (!parsed || !this.ports.has(port) || this.ports.size !== 1) return false;
    this.multipleDashboardTabsLatched = false;
    this.replaceState(parsed.state);
    return true;
  }

  private eligiblePort(): AutomationPort | null {
    if (this.ports.size !== 1 || this.multipleDashboardTabsLatched) return null;
    return this.ports.values().next().value ?? null;
  }

  private enterMultipleDashboardTabsSafetyStop(): void {
    this.multipleDashboardTabsLatched = true;
    this.replaceState(unavailableAutomationState("MULTIPLE_DASHBOARD_TABS"));
    const safetyStop = { type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION, errorCode: "MULTIPLE_DASHBOARD_TABS" } as const;
    for (const port of this.ports) port.postMessage(safetyStop);
    this.onMultipleDashboardTabs();
  }

  private replaceState(state: CodeArchiveAutomationState): void {
    this.state = { ...state };
    if (this.waiters.size === 0) return;
    const response = { state: this.getState(), forwarded: true };
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(response);
    }
    this.waiters.clear();
  }

  private waitForState(forwarded: boolean): Promise<PopupAutomationStateResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const waiter = [...this.waiters].find((candidate) => candidate.timer === timer);
        if (waiter) this.waiters.delete(waiter);
        resolve({ state: this.getState(), forwarded });
      }, STATE_WAIT_MS);
      this.waiters.add({ resolve, timer });
    });
  }
}

type ChromeRuntime = {
  sendMessage?: (message: PopupAutomationMessage, callback: (response: PopupAutomationStateResponse | PopupAutomationSetResponse) => void) => void;
};

function popupRuntime(): ChromeRuntime | null {
  const candidate = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  return candidate?.sendMessage ? candidate : null;
}

export function requestPopupAutomationState(): Promise<PopupAutomationStateResponse> {
  const runtime = popupRuntime();
  if (!runtime) return Promise.resolve({ state: unavailableAutomationState(), forwarded: false });
  return new Promise((resolve) => runtime.sendMessage?.({ type: POPUP_AUTOMATION_STATE_GET }, (response) => resolve(response ?? { state: unavailableAutomationState(), forwarded: false })));
}

export function setPopupAutomation(automation: CodeArchiveAutomationKind, enabled: boolean): Promise<PopupAutomationSetResponse> {
  const runtime = popupRuntime();
  if (!runtime) return Promise.resolve({ accepted: false, state: unavailableAutomationState(), forwarded: false });
  return new Promise((resolve) => runtime.sendMessage?.({ type: POPUP_AUTOMATION_SET, automation, enabled }, (response) => resolve(response as PopupAutomationSetResponse ?? { accepted: false, state: unavailableAutomationState(), forwarded: false })));
}

export function automationGuidance(state: CodeArchiveAutomationState): string {
  if (state.errorCode === "MULTIPLE_DASHBOARD_TABS") return "Dashboard 탭을 하나만 남긴 뒤 다시 연결해주세요.";
  if (state.errorCode === "AUTH_REQUIRED") return "Dashboard에서 로그인을 완료해주세요.";
  if (state.errorCode === "AUTO_SYNC_CONSENT_REQUIRED") return "Dashboard에서 자동 동기화 동의를 완료해주세요.";
  if (state.errorCode === "GITHUB_TARGET_REQUIRED") return "Dashboard에서 GitHub 저장 위치를 설정해주세요.";
  if (state.errorCode === "GITHUB_CONSENT_REQUIRED" || state.errorCode === "PUBLIC_REPOSITORY_CONSENT_REQUIRED") return "Dashboard에서 GitHub 업로드 동의를 완료해주세요.";
  if (!state.connectionAvailable || state.errorCode === "DASHBOARD_DISCONNECTED") return "Dashboard를 열어 연결한 뒤 자동화를 설정해주세요.";
  if (state.errorCode) return "현재 Dashboard에서 자동화 제어를 사용할 수 없습니다.";
  return "Dashboard가 최종 자동화 상태를 관리합니다.";
}
