import {
  CODEARCHIVE_BRIDGE_MAX_RESPONSE_BYTES,
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT,
  CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS,
  type CaptureSyncScope,
  type CodeArchiveBridgeErrorCode,
  type CodeArchiveBridgeFailure,
  type CodeArchiveBridgeResponse,
  type CodeArchiveCaptureAckReceipt,
  type CodeArchiveCaptureChangedEvent,
  type CodeArchiveCapturePageData,
  type CodeArchiveCaptureSummaryData,
  type CodeArchiveImportBeginData,
  type CodeArchivePingData,
  type DashboardBridgeRequest,
} from "../../../packages/shared-types/src";
import {
  InvalidCaptureCursorError,
  indexedDbCaptureBridgeRepository,
  type CaptureBridgeRepository,
} from "./solutionRepository";

const CAPABILITY_IDLE_MS = 2 * 60 * 1000;
const CAPABILITY_ABSOLUTE_MS = 15 * 60 * 1000;
const MAX_ACK_IDS = CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT * CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS;

export interface ExternalDashboardSender {
  origin?: string;
  url?: string;
  tab?: { id?: number };
}

export interface ExternalDashboardPort {
  sender?: ExternalDashboardSender;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
}

interface CapabilityState {
  value: string;
  createdAt: number;
  lastActivityAt: number;
  pageRequests: number;
  offeredClientRecordIds: Set<string>;
}

interface PortSession {
  port: ExternalDashboardPort;
  origin: string;
  url: string;
  tabId: number;
  capability?: CapabilityState;
}

function failure(code: CodeArchiveBridgeErrorCode): CodeArchiveBridgeFailure {
  return {
    ok: false,
    error: {
      code,
      retryable: code === "CAPABILITY_EXPIRED" || code === "REQUEST_LIMIT_EXCEEDED" || code === "INTERNAL_ERROR",
    },
  };
}

function success<T>(data: T): CodeArchiveBridgeResponse<T> {
  return { ok: true, data };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseRequest(value: unknown): DashboardBridgeRequest | CodeArchiveBridgeFailure {
  if (!isObject(value) || !stringField(value.type)) return failure("INVALID_REQUEST");
  if (value.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION) {
    return typeof value.protocolVersion === "number" ? failure("UNSUPPORTED_PROTOCOL") : failure("INVALID_REQUEST");
  }

  switch (value.type) {
    case "CODEARCHIVE_PING":
    case "CODEARCHIVE_CAPTURE_SUMMARY":
    case "CODEARCHIVE_IMPORT_BEGIN":
      return value as unknown as DashboardBridgeRequest;
    case "CODEARCHIVE_CAPTURE_PAGE": {
      if (!stringField(value.capability)) return failure("CAPABILITY_REQUIRED");
      if (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT) {
        return failure("INVALID_REQUEST");
      }
      if (value.scope !== "pending" && value.scope !== "all") return failure("INVALID_REQUEST");
      if (value.cursor !== undefined && !stringField(value.cursor)) return failure("INVALID_CURSOR");
      return value as unknown as DashboardBridgeRequest;
    }
    case "CODEARCHIVE_CAPTURE_ACK": {
      if (!stringField(value.capability)) return failure("CAPABILITY_REQUIRED");
      if (!stringField(value.importBatchId) || !Array.isArray(value.clientRecordIds) || value.clientRecordIds.length > MAX_ACK_IDS) {
        return failure("INVALID_REQUEST");
      }
      const ids = value.clientRecordIds;
      if (!ids.every(stringField) || new Set(ids as string[]).size !== ids.length) return failure("INVALID_REQUEST");
      return value as unknown as DashboardBridgeRequest;
    }
    default:
      return failure("INVALID_REQUEST");
  }
}

function responseBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizedHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function senderMatchesExactOrigin(sender: ExternalDashboardSender | undefined, allowedOrigin: string): sender is { origin: string; url: string; tab: { id: number } } {
  if (!sender || typeof sender.origin !== "string" || typeof sender.url !== "string" || !Number.isInteger(sender.tab?.id)) return false;
  const senderOrigin = normalizedHttpsOrigin(sender.origin);
  let urlOrigin: string;
  try { urlOrigin = new URL(sender.url).origin; } catch { return false; }
  return senderOrigin === allowedOrigin && urlOrigin === allowedOrigin;
}

export class ExtensionDashboardCaptureBridge {
  private readonly sessions = new Map<ExternalDashboardPort, PortSession>();

  constructor(
    private readonly repository: CaptureBridgeRepository,
    private readonly now: () => number = () => Date.now(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  connect(port: ExternalDashboardPort, allowedOriginValue: string): boolean {
    const allowedOrigin = normalizedHttpsOrigin(allowedOriginValue);
    const sender = port.sender;
    if (!allowedOrigin || !senderMatchesExactOrigin(sender, allowedOrigin)) {
      port.disconnect();
      return false;
    }

    const session: PortSession = {
      port,
      origin: allowedOrigin,
      url: sender.url,
      tabId: sender.tab.id,
    };
    this.sessions.set(port, session);
    port.onMessage.addListener((message) => { void this.handleMessage(session, message); });
    port.onDisconnect.addListener(() => this.disconnect(port));
    return true;
  }

  disconnect(port: ExternalDashboardPort): void {
    const session = this.sessions.get(port);
    if (session) delete session.capability;
    this.sessions.delete(port);
  }

  activePortCount(): number {
    return this.sessions.size;
  }

  async notifyCaptureChanged(): Promise<void> {
    if (this.sessions.size === 0) return;
    const at = this.now();
    const eligible = [...this.sessions.values()].filter((session) => this.validCapabilityForEvent(session, at));
    if (eligible.length === 0) return;
    const summary = await this.repository.summary();
    const event: CodeArchiveCaptureChangedEvent = {
      type: "CODEARCHIVE_CAPTURE_CHANGED",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      pendingCount: summary.pendingCount,
      revision: summary.revision,
    };
    for (const session of eligible) session.port.postMessage(event);
  }

  private validCapabilityForEvent(session: PortSession, at: number): boolean {
    const capability = session.capability;
    if (!capability) return false;
    if (this.isExpired(capability, at)) {
      delete session.capability;
      return false;
    }
    return true;
  }

  private async handleMessage(session: PortSession, raw: unknown): Promise<void> {
    const parsed = parseRequest(raw);
    if ("ok" in parsed && parsed.ok === false) {
      session.port.postMessage(parsed);
      return;
    }

    try {
      const response = await this.execute(session, parsed as DashboardBridgeRequest);
      session.port.postMessage(responseBytes(response) <= CODEARCHIVE_BRIDGE_MAX_RESPONSE_BYTES ? response : failure("PAYLOAD_LIMIT_EXCEEDED"));
    } catch (error) {
      session.port.postMessage(error instanceof InvalidCaptureCursorError ? failure("INVALID_CURSOR") : failure("INTERNAL_ERROR"));
    }
  }

  private async execute(session: PortSession, request: DashboardBridgeRequest): Promise<unknown> {
    switch (request.type) {
      case "CODEARCHIVE_PING": {
        const data: CodeArchivePingData = { protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION };
        return success(data);
      }
      case "CODEARCHIVE_CAPTURE_SUMMARY": {
        const summary = await this.repository.summary();
        const data: CodeArchiveCaptureSummaryData = {
          protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
          pendingCount: summary.pendingCount,
          allCount: summary.allCount,
          revision: summary.revision,
        };
        return success(data);
      }
      case "CODEARCHIVE_IMPORT_BEGIN": {
        const at = this.now();
        const capability: CapabilityState = {
          value: this.uuid(),
          createdAt: at,
          lastActivityAt: at,
          pageRequests: 0,
          offeredClientRecordIds: new Set(),
        };
        session.capability = capability;
        const data: CodeArchiveImportBeginData = {
          protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
          capability: capability.value,
        };
        return success(data);
      }
      case "CODEARCHIVE_CAPTURE_PAGE": {
        const capabilityResult = this.requireCapability(session, request.capability);
        if ("ok" in capabilityResult) return capabilityResult;
        const capability = capabilityResult;
        if (capability.pageRequests >= CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS) return failure("REQUEST_LIMIT_EXCEEDED");
        capability.pageRequests += 1;
        capability.lastActivityAt = this.now();
        const page = await this.repository.page(request.scope as CaptureSyncScope, request.cursor, request.limit);
        const data: CodeArchiveCapturePageData = {
          protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
          scope: request.scope,
          records: page.records,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          revision: page.revision,
        };
        const response = success(data);
        if (responseBytes(response) > CODEARCHIVE_BRIDGE_MAX_RESPONSE_BYTES) return failure("PAYLOAD_LIMIT_EXCEEDED");
        for (const record of page.records) capability.offeredClientRecordIds.add(record.clientRecordId);
        return response;
      }
      case "CODEARCHIVE_CAPTURE_ACK": {
        const capabilityResult = this.requireCapability(session, request.capability);
        if ("ok" in capabilityResult) return capabilityResult;
        const capability = capabilityResult;
        if (request.clientRecordIds.some((id) => !capability.offeredClientRecordIds.has(id))) return failure("ACK_NOT_OFFERED");
        capability.lastActivityAt = this.now();
        const acknowledgedAt = new Date(this.now()).toISOString();
        const acknowledgedClientRecordIds = await this.repository.acknowledge(request.clientRecordIds, request.importBatchId, acknowledgedAt);
        const data: CodeArchiveCaptureAckReceipt = {
          protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
          importBatchId: request.importBatchId,
          acknowledgedAt,
          acknowledgedClientRecordIds,
        };
        return success(data);
      }
    }
  }

  private requireCapability(session: PortSession, value: string): CapabilityState | CodeArchiveBridgeFailure {
    const capability = session.capability;
    if (!capability || capability.value !== value) return failure("CAPABILITY_INVALID");
    if (this.isExpired(capability, this.now())) {
      delete session.capability;
      return failure("CAPABILITY_EXPIRED");
    }
    return capability;
  }

  private isExpired(capability: CapabilityState, at: number): boolean {
    return at - capability.lastActivityAt >= CAPABILITY_IDLE_MS || at - capability.createdAt >= CAPABILITY_ABSOLUTE_MS;
  }
}

export interface ExternalRuntimeApi {
  onConnectExternal: {
    addListener(listener: (port: ExternalDashboardPort) => void): void;
  };
}

/**
 * Registration is intentionally parameterized by an approved exact HTTPS origin.
 * Issue #89 does not invoke this from background.ts until the manifest/origin gate is approved.
 */
export function registerExternalDashboardBridge(
  runtime: ExternalRuntimeApi,
  allowedOrigin: string,
  bridge: ExtensionDashboardCaptureBridge = backgroundDashboardCaptureBridge,
): void {
  runtime.onConnectExternal.addListener((port) => { bridge.connect(port, allowedOrigin); });
}

export const backgroundDashboardCaptureBridge = new ExtensionDashboardCaptureBridge(indexedDbCaptureBridgeRepository);

export async function notifyDashboardCaptureChanged(): Promise<void> {
  await backgroundDashboardCaptureBridge.notifyCaptureChanged();
}
