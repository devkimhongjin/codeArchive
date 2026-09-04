import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT,
  CODEARCHIVE_RELAY_CHALLENGE_ID_MAX_LENGTH,
  CODEARCHIVE_RELAY_DEVICE_ID_MAX_LENGTH,
  CODEARCHIVE_RELAY_DEVICE_ID_MIN_LENGTH,
  CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH,
  CODEARCHIVE_RELAY_PUBLIC_KEY_MAX_LENGTH,
  CODEARCHIVE_RELAY_SIGNATURE_MAX_LENGTH,
  type ClientRecordId,
  type CodeArchiveBridgeFailure,
  type CodeArchiveCaptureAckResponse,
  type CodeArchiveCaptureChangedEvent,
  type CodeArchiveCaptureSummaryData,
  type CodeArchiveCaptureSummaryResponse,
  type CodeArchiveAutomationState,
  type CodeArchiveImportBeginResponse,
  type CodeArchivePingResponse,
  type CodeArchiveRelayGrantProvisionRequest,
  type CodeArchiveRelayGrantProvisionResponse,
  type CodeArchiveRelayPairingInfoResponse,
  type CodeArchiveRelayRevokeConfirmedRequest,
  type CodeArchiveRelayRevokeConfirmedResponse,
  type CodeArchiveRelaySignChallengeRequest,
  type CodeArchiveRelaySignChallengeResponse,
  type CodeArchiveSyncSessionEndResponse,
  type CodeArchiveSyncSessionStartResponse,
  type ExtensionToDashboardAutomationMessage,
} from "../../../packages/shared-types/src";
import { CODEARCHIVE_EXTENSION_ID } from "./extensionConfig";
import { isAutomationControlType, parseAutomationMessage } from "./automationControl";

const BRIDGE_RESPONSE_TIMEOUT_MS = 5_000;
// Keep a bounded recovery window long enough for ordinary service-worker suspension/wake,
// without turning a missing Extension into a retry storm.
const RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000, 120_000, 300_000] as const;

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
  relayPairingInfo(): Promise<CodeArchiveRelayPairingInfoResponse | null>;
  relaySignChallenge(request: CodeArchiveRelaySignChallengeRequest): Promise<CodeArchiveRelaySignChallengeResponse | null>;
  relayProvisionGrant(request: CodeArchiveRelayGrantProvisionRequest): Promise<CodeArchiveRelayGrantProvisionResponse | null>;
  relayConfirmRevoke(request: CodeArchiveRelayRevokeConfirmedRequest): Promise<CodeArchiveRelayRevokeConfirmedResponse | null>;
}

function safeFailure(value: unknown): value is CodeArchiveBridgeFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; error?: { code?: unknown } };
  return candidate.ok === false && typeof candidate.error?.code === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validDevice(value: unknown): value is string {
  return bounded(value, CODEARCHIVE_RELAY_DEVICE_ID_MAX_LENGTH)
    && value.length >= CODEARCHIVE_RELAY_DEVICE_ID_MIN_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validUuid(value: unknown, max: number): value is string {
  return bounded(value, max) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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

function isPairingInfo(value: unknown): value is CodeArchiveRelayPairingInfoResponse {
  if (!isObject(value) || value.type !== "CODEARCHIVE_RELAY_PAIRING_INFO" || value.phase !== "INFO"
    || value.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION || !validDevice(value.deviceId)
    || !bounded(value.publicKey, CODEARCHIVE_RELAY_PUBLIC_KEY_MAX_LENGTH)
    || !["UNPAIRED", "ACTIVE", "REVOCATION_PENDING", "EXPIRED", "INVALIDATED"].includes(String(value.state))) return false;
  if (value.state === "UNPAIRED") return exactKeys(value, ["type", "phase", "protocolVersion", "deviceId", "publicKey", "state"]);
  return exactKeys(value, ["type", "phase", "protocolVersion", "deviceId", "publicKey", "state", "grantId", "generation", "expiresAt"])
    && validUuid(value.grantId, CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH)
    && validGeneration(value.generation)
    && validDate(value.expiresAt);
}

function isSignedChallenge(value: unknown): value is CodeArchiveRelaySignChallengeResponse {
  return isObject(value)
    && exactKeys(value, ["type", "phase", "protocolVersion", "deviceId", "challengeId", "signature"])
    && value.type === "CODEARCHIVE_RELAY_SIGN_CHALLENGE" && value.phase === "SIGNED"
    && value.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && validDevice(value.deviceId)
    && validUuid(value.challengeId, CODEARCHIVE_RELAY_CHALLENGE_ID_MAX_LENGTH)
    && bounded(value.signature, CODEARCHIVE_RELAY_SIGNATURE_MAX_LENGTH)
    && /^[A-Za-z0-9_-]+$/.test(value.signature);
}

function isStoredGrant(value: unknown): value is CodeArchiveRelayGrantProvisionResponse {
  return isObject(value)
    && exactKeys(value, ["type", "phase", "protocolVersion", "deviceId", "grantId", "generation", "expiresAt"])
    && value.type === "CODEARCHIVE_RELAY_GRANT_PROVISION" && value.phase === "STORED"
    && value.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && validDevice(value.deviceId)
    && validUuid(value.grantId, CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH)
    && validGeneration(value.generation)
    && validDate(value.expiresAt);
}

function isAppliedRevoke(value: unknown): value is CodeArchiveRelayRevokeConfirmedResponse {
  return isObject(value)
    && exactKeys(value, ["type", "phase", "protocolVersion", "deviceId", "grantId", "generation", "revokedAt"])
    && value.type === "CODEARCHIVE_RELAY_REVOKE_CONFIRMED" && value.phase === "APPLIED"
    && value.protocolVersion === CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
    && validDevice(value.deviceId)
    && validUuid(value.grantId, CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH)
    && validGeneration(value.generation)
    && validDate(value.revokedAt);
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
        let requestTail: Promise<void> = Promise.resolve();

        try {
          port = runtime.connect(extensionId, { name: "codearchive-dashboard" });
        } catch {
          activeBridge = null;
          onState({ status: "error" });
          retry();
          return;
        }

        const request = <T>(message: unknown) => new Promise<T | null>((resolve) => {
          const execute = () => new Promise<void>((done) => {
            if (!active || disposed) { resolve(null); done(); return; }
            const complete = (response: unknown) => {
              globalThis.clearTimeout(timeout);
              resolve(response as T | null);
              done();
            };
            const timeout = globalThis.setTimeout(() => {
              const index = pending.indexOf(complete);
              if (index >= 0) pending.splice(index, 1);
              resolve(null);
              done();
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
          requestTail = requestTail.then(execute, execute);
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
          pending.splice(0).forEach((resolvePending) => resolvePending(null));
          onState({ status: runtime.lastError ? "error" : "unavailable" });
          retry();
        });

        const terminalError = () => {
          if (!active) return;
          active = false;
          if (activeBridge === bridge) activeBridge = null;
          pending.splice(0).forEach((resolvePending) => resolvePending(null));
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
          // A successful handshake closes this outage. A later disconnect gets its own
          // bounded recovery window instead of inheriting attempts from an earlier outage.
          retries = 0;
          onState({ status: "connected", summary: summary.data });
        })();

        stopAttempt = () => {
          if (!active) return;
          active = false;
          if (activeBridge === bridge) activeBridge = null;
          pending.splice(0).forEach((resolvePending) => resolvePending(null));
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

    async relayPairingInfo() {
      const bridge = activeBridge;
      if (!bridge) return null;
      const response = await bridge.request<unknown>({
        type: "CODEARCHIVE_RELAY_PAIRING_INFO",
        phase: "REQUEST",
        protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      });
      return response && !safeFailure(response) && isPairingInfo(response) ? response : null;
    },

    async relaySignChallenge(request) {
      const bridge = activeBridge;
      if (!bridge) return null;
      const response = await bridge.request<unknown>(request);
      return response && !safeFailure(response) && isSignedChallenge(response) ? response : null;
    },

    async relayProvisionGrant(request) {
      const bridge = activeBridge;
      if (!bridge) return null;
      const response = await bridge.request<unknown>(request);
      return response && !safeFailure(response) && isStoredGrant(response) ? response : null;
    },

    async relayConfirmRevoke(request) {
      const bridge = activeBridge;
      if (!bridge) return null;
      const response = await bridge.request<unknown>(request);
      return response && !safeFailure(response) && isAppliedRevoke(response) ? response : null;
    },
  };
}

export const dashboardExtensionConnection = createDashboardExtensionConnection();
