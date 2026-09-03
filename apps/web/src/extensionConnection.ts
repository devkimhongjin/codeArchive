import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT,
  type ClientRecordId,
  type CodeArchiveBridgeFailure,
  type CodeArchiveCaptureAckResponse,
  type CodeArchiveCaptureChangedEvent,
  type CodeArchiveCaptureSummaryData,
  type CodeArchiveCaptureSummaryResponse,
  type CodeArchiveAutomationState,
  type CodeArchiveImportBeginResponse,
  type CodeArchivePingResponse,
  type CodeArchiveSyncSessionEndResponse,
  type CodeArchiveSyncSessionStartResponse,
  type ExtensionToDashboardAutomationMessage,
} from "../../../packages/shared-types/src";
import { CODEARCHIVE_EXTENSION_ID } from "./extensionConfig";
import { isAutomationControlType, parseAutomationMessage } from "./automationControl";

const BRIDGE_RESPONSE_TIMEOUT_MS = 5_000;
const RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000] as const;

interface RuntimePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

interface ChromeRuntime {
  lastError?: { message?: string };
  connect(extensionId: string, connectInfo: { name: string }): RuntimePort;
}

interface ActiveBridge {
  request<T>(message: unknown): Promise<T | null>;
  publish(message: unknown): boolean;
}

export type ExtensionConnectionState =
  | { readonly status: "unavailable" }
  | { readonly status: "connecting" }
  | { readonly status: "connected"; readonly summary: CodeArchiveCaptureSummaryData }
  | { readonly status: "error" };

export interface DashboardExtensionConnection {
  start(
    onState: (state: ExtensionConnectionState) => void,
    onCaptureChanged?: (event: CodeArchiveCaptureChangedEvent) => void,
    onAutomationMessage?: (message: ExtensionToDashboardAutomationMessage) => void,
  ): () => void;
  publishAutomationState?(state: CodeArchiveAutomationState): boolean;
  startSyncSession(syncSessionId: string): Promise<boolean>;
  endSyncSession(syncSessionId: string): Promise<void>;
  beginImport?(syncSessionId: string): Promise<string | null>;
  readPendingPage?(capability: string, cursor?: string): Promise<unknown>;
  ackImported?(capability: string, importBatchId: string, clientRecordIds: readonly ClientRecordId[]): Promise<boolean>;
}

function safeFailure(value: unknown): value is CodeArchiveBridgeFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; error?: { code?: unknown } };
  return candidate.ok === false && typeof candidate.error?.code === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPingResponse(value: unknown): value is CodeArchivePingResponse {
  if (!isObject(value) || value.ok !== true || !isObject(value.data)) return false;
  return value.data.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION;
}

function isSummaryResponse(value: unknown): value is CodeArchiveCaptureSummaryResponse {
  if (!isObject(value) || value.ok !== true || !isObject(value.data)) return false;
  const data = value.data;
  return data.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && Number.isInteger(data.pendingCount) && (data.pendingCount as number) >= 0
    && Number.isInteger(data.allCount) && (data.allCount as number) >= 0
    && Number.isInteger(data.revision) && (data.revision as number) >= 0;
}

function isSyncSessionResponse(
  value: unknown,
  syncSessionId: string,
): value is CodeArchiveSyncSessionStartResponse | CodeArchiveSyncSessionEndResponse {
  if (!isObject(value) || value.ok !== true || !isObject(value.data)) return false;
  return value.data.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && value.data.syncSessionId === syncSessionId;
}

function isCaptureChangedEvent(value: unknown): value is CodeArchiveCaptureChangedEvent {
  if (!isObject(value)) return false;
  return value.type === "CODEARCHIVE_CAPTURE_CHANGED"
    && value.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && Number.isInteger(value.pendingCount) && (value.pendingCount as number) >= 0
    && Number.isInteger(value.revision) && (value.revision as number) >= 0;
}

function isImportBeginResponse(value: unknown): value is CodeArchiveImportBeginResponse {
  if (!isObject(value) || value.ok !== true || !isObject(value.data)) return false;
  return value.data.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && typeof value.data.capability === "string"
    && value.data.capability.length > 0;
}

function isAckResponse(value: unknown, importBatchId: string, requestedIds: readonly string[]): value is CodeArchiveCaptureAckResponse {
  if (!isObject(value) || value.ok !== true || !isObject(value.data)) return false;
  const data = value.data;
  if (
    data.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    || data.importBatchId !== importBatchId
    || typeof data.acknowledgedAt !== "string"
    || !Array.isArray(data.acknowledgedClientRecordIds)
  ) return false;
  const requested = new Set(requestedIds);
  return data.acknowledgedClientRecordIds.every((id) => typeof id === "string" && requested.has(id));
}

function runtimeFromPage(): ChromeRuntime | null {
  const candidate = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  return candidate && typeof candidate.connect === "function" ? candidate : null;
}

export function createDashboardExtensionConnection(
  runtime: ChromeRuntime | null = runtimeFromPage(),
  extensionId = CODEARCHIVE_EXTENSION_ID,
): DashboardExtensionConnection {
  let activeBridge: ActiveBridge | null = null;
  let stopPrevious: (() => void) | undefined;

  return {
    start(onState, onCaptureChanged, onAutomationMessage) {
      stopPrevious?.();
      if (!runtime) {
        activeBridge = null;
        onState({ status: "unavailable" });
        return () => undefined;
      }

      let disposed = false;
      let retries = 0;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let stopAttempt = () => undefined;
      const retry = () => {
        if (disposed || retries >= RECONNECT_DELAYS_MS.length) return;
        retryTimer = globalThis.setTimeout(() => {
          retryTimer = undefined;
          if (!disposed) connect();
        }, RECONNECT_DELAYS_MS[retries++]);
      };
      const connect = () => {
        onState({ status: "connecting" });
        let active = true;
        let port: RuntimePort;
        const pending: Array<(message: unknown) => void> = [];

        try {
          port = runtime.connect(extensionId, { name: "codearchive-dashboard" });
        } catch {
          activeBridge = null;
          onState({ status: "error" });
          retry();
          return;
        }

        const request = <T>(message: unknown) => new Promise<T | null>((resolve) => {
          if (!active) { resolve(null); return; }
          const complete = (response: unknown) => {
            globalThis.clearTimeout(timeout);
            resolve(response as T | null);
          };
          const timeout = globalThis.setTimeout(() => {
            const index = pending.indexOf(complete);
            if (index >= 0) pending.splice(index, 1);
            resolve(null);
            terminalError();
          }, BRIDGE_RESPONSE_TIMEOUT_MS);
          pending.push(complete);
          try {
            port.postMessage(message);
          } catch {
            const index = pending.indexOf(complete);
            if (index >= 0) pending.splice(index, 1);
            complete(null);
            terminalError();
          }
        });

        const bridge: ActiveBridge = {
          request,
          publish(message) {
            if (!active || disposed) return false;
            try { port.postMessage(message); return true; } catch { return false; }
          },
        };
        activeBridge = bridge;

        port.onMessage.addListener((message) => {
          if (!active || disposed) return;
          if (isCaptureChangedEvent(message)) {
            onCaptureChanged?.(message);
            return;
          }
          const automation = parseAutomationMessage(message);
          if (automation) {
            onAutomationMessage?.(automation);
            return;
          }
          if (isAutomationControlType(message)) return;
          pending.shift()?.(message);
        });
        port.onDisconnect.addListener(() => {
          if (!active) return;
          active = false;
          if (activeBridge === bridge) activeBridge = null;
          pending.splice(0).forEach((resolve) => resolve(null));
          onState({ status: runtime.lastError ? "error" : "unavailable" });
          retry();
        });

        const terminalError = () => {
          if (!active) return;
          active = false;
          if (activeBridge === bridge) activeBridge = null;
          pending.splice(0).forEach((resolve) => resolve(null));
          port.disconnect();
          onState({ status: "error" });
          retry();
        };

        void (async () => {
          const ping = await request<CodeArchivePingResponse>({
            type: "CODEARCHIVE_PING",
            protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
          });
          if (!active) return;
          if (!ping || safeFailure(ping) || !isPingResponse(ping)) {
            terminalError();
            return;
          }

          const summary = await request<CodeArchiveCaptureSummaryResponse>({
            type: "CODEARCHIVE_CAPTURE_SUMMARY",
            protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
          });
          if (!active) return;
          if (!summary || safeFailure(summary) || !isSummaryResponse(summary)) {
            terminalError();
            return;
          }
          onState({ status: "connected", summary: summary.data });
        })();

        stopAttempt = () => {
          if (!active) return;
          active = false;
          if (activeBridge === bridge) activeBridge = null;
          pending.splice(0).forEach((resolve) => resolve(null));
          port.disconnect();
        };
      };
      connect();
      const stop = () => {
        disposed = true;
        globalThis.clearTimeout(retryTimer);
        stopAttempt();
        if (stopPrevious === stop) stopPrevious = undefined;
      };
      stopPrevious = stop;
      return stop;
    },

    publishAutomationState(state) {
      const bridge = activeBridge;
      return Boolean(bridge?.publish({
        type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        state,
      }));
    },

    async startSyncSession(syncSessionId) {
      const bridge = activeBridge;
      if (!bridge) return false;
      const response = await bridge.request<CodeArchiveSyncSessionStartResponse>({
        type: "CODEARCHIVE_SYNC_SESSION_START",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        syncSessionId,
        authenticated: true,
        autoSyncConsent: true,
      });
      return Boolean(response && !safeFailure(response) && isSyncSessionResponse(response, syncSessionId));
    },

    async endSyncSession(syncSessionId) {
      const bridge = activeBridge;
      if (!bridge) return;
      await bridge.request<CodeArchiveSyncSessionEndResponse>({
        type: "CODEARCHIVE_SYNC_SESSION_END",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        syncSessionId,
      });
    },

    async beginImport(syncSessionId) {
      const bridge = activeBridge;
      if (!bridge) return null;
      const response = await bridge.request<CodeArchiveImportBeginResponse>({
        type: "CODEARCHIVE_IMPORT_BEGIN",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        syncSessionId,
      });
      return response && !safeFailure(response) && isImportBeginResponse(response)
        ? response.data.capability
        : null;
    },

    async readPendingPage(capability, cursor) {
      const bridge = activeBridge;
      if (!bridge) return null;
      return bridge.request<unknown>({
        type: "CODEARCHIVE_CAPTURE_PAGE",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        capability,
        ...(cursor ? { cursor } : {}),
        limit: CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT,
        scope: "pending",
      });
    },

    async ackImported(capability, importBatchId, clientRecordIds) {
      if (clientRecordIds.length === 0) return true;
      const bridge = activeBridge;
      if (!bridge) return false;
      const response = await bridge.request<CodeArchiveCaptureAckResponse>({
        type: "CODEARCHIVE_CAPTURE_ACK",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        capability,
        importBatchId,
        clientRecordIds,
      });
      return Boolean(response && !safeFailure(response) && isAckResponse(response, importBatchId, clientRecordIds));
    },
  };
}

export const dashboardExtensionConnection = createDashboardExtensionConnection();
