import { createUuid } from "./capture";
import type { Capture, CaptureSettings } from "./types";
import type { CaptureStore, CaptureSummary } from "./storage";
import type { Platform } from "./types";
import { BUILD_METADATA } from "../../../shared/buildMetadata";
import { normalizedHeaderFields, type HeaderField } from "../../../shared/headerFields";

export const DASHBOARD_ORIGIN = "https://codearchive-dashboard-beta.netlify.app";
export const DASHBOARD_ORIGINS = [
  DASHBOARD_ORIGIN,
  "http://localhost:5173"
] as const;
export const SESSION_IDLE_TTL_MS = 5 * 60 * 1_000;
export const SESSION_ABSOLUTE_TTL_MS = 15 * 60 * 1_000;
export const MAX_PENDING_PAGE_SIZE = 50;

export type DashboardMessage =
  | { type: "CONNECT" }
  | { type: "PING"; capability: string }
  | { type: "GET_STATUS"; capability: string }
  | { type: "GET_PENDING"; capability: string; limit?: number }
  /** Read-only, capability-bound local archive view for an unauthenticated dashboard. */
  | { type: "GET_LOCAL_ARCHIVE"; capability: string; limit?: number }
  | { type: "GET_HISTORICAL_ARCHIVE"; capability: string; limit?: number }
  | { type: "GET_HISTORICAL_SUMMARY"; capability: string }
  | { type: "GET_HISTORICAL_SUBMISSION_IDS"; capability: string; platform: "JUNGOL" }
  | { type: "GET_HISTORICAL_BY_SUBMISSION_IDS"; capability: string; platform: "JUNGOL"; submissionIds: string[] }
  | { type: "HISTORY_PREVIEW"; capability: string; platform: "SWEA" | "JUNGOL" | "PROGRAMMERS" }
  | { type: "HISTORY_IMPORT"; capability: string; platform: "JUNGOL"; submissionIds: string[] }
  /** Reuse a durable relay after an MV3 service-worker restart without exposing its bearer secret. */
  | { type: "REUSE_RELAY"; capability: string; accountId: string; settingsVersion: number }
  | { type: "ACK"; capability: string; captureIds: string[] }
  | { type: "CONFIGURE_RELAY"; capability: string; relay: { endpoint: string; secret: string; accountId: string; generation: number } | null; accountId?: string; settingsVersion?: number; autoSyncEnabled?: boolean; githubAutoCommitEnabled?: boolean; githubTargetConfigured?: boolean; copyHeader?: boolean; downloadHeader?: boolean; copyHeaderFields?: HeaderField[]; downloadHeaderFields?: HeaderField[]; downloadFilenameTemplate?: string; gitPathTemplate?: string; name?: string | null; nickname?: string | null; lightTheme?: string; darkTheme?: string }
  | { type: "DISCONNECT"; capability: string };

export interface DashboardSender {
  url?: string;
  documentId?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

export type BridgeResponse =
  | { capability: string; expiresAt: number; version: string; features: string[] }
  | { pendingCount: number }
  | { captures: Capture[]; hasMore: boolean; localOnly?: boolean }
  | { captures: Capture[]; totalCount: number; localOnly: true }
  | { summary: Record<Platform, CaptureSummary>; localOnly: true }
  | { submissionIds: string[]; localOnly: true }
  | { reused: boolean }
  | { history: unknown }
  | { ok: true }
  | { error: "UNAUTHORIZED" | "BAD_REQUEST" | "STALE_CONFIGURATION" | "HISTORY_UNAVAILABLE" };

interface SenderIdentity {
  tabId: number;
  documentId: string;
  frameId: number;
}

interface Session {
  capability: string;
  identity: SenderIdentity;
  issuedAt: number;
  lastUsedAt: number;
  issuedCaptureIds: Set<string>;
}

export interface DashboardBridgeOptions {
  now?: () => number;
  capabilityFactory?: () => string;
  idleTtlMs?: number;
  absoluteTtlMs?: number;
  onRelayConfigured?: () => void;
  onHistoryPreview?: (platform: "SWEA" | "JUNGOL" | "PROGRAMMERS") => Promise<unknown>;
  onHistoryImport?: (submissionIds: string[]) => Promise<unknown>;
}

function exactDashboardSender(sender: DashboardSender): boolean {
  if (typeof sender.url !== "string" || typeof sender.tab?.url !== "string") return false;
  try {
    const senderOrigin = new URL(sender.url).origin;
    const tabOrigin = new URL(sender.tab.url).origin;
    return senderOrigin === tabOrigin && DASHBOARD_ORIGINS.includes(senderOrigin as typeof DASHBOARD_ORIGINS[number]);
  } catch {
    return false;
  }
}

function senderIdentity(sender: DashboardSender): SenderIdentity | null {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || (tabId as number) < 0) return null;
  const frameId = Number.isInteger(sender.frameId) ? (sender.frameId as number) : 0;
  const documentId = sender.documentId?.trim();
  if (!documentId) return null;
  return { tabId: tabId as number, documentId, frameId };
}

function sameIdentity(left: SenderIdentity, right: SenderIdentity): boolean {
  return (
    left.tabId === right.tabId &&
    left.documentId === right.documentId &&
    left.frameId === right.frameId
  );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isMessageType(value: unknown): value is DashboardMessage["type"] {
  return value === "CONNECT" || value === "PING" || value === "GET_STATUS" || value === "GET_PENDING" || value === "GET_LOCAL_ARCHIVE" || value === "GET_HISTORICAL_ARCHIVE" || value === "GET_HISTORICAL_SUMMARY" || value === "GET_HISTORICAL_SUBMISSION_IDS" || value === "GET_HISTORICAL_BY_SUBMISSION_IDS" || value === "HISTORY_PREVIEW" || value === "HISTORY_IMPORT" || value === "REUSE_RELAY" || value === "ACK" || value === "CONFIGURE_RELAY" || value === "DISCONNECT";
}

export class DashboardBridge {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly capabilityFactory: () => string;
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;
  private readonly onRelayConfigured: () => void;
  private readonly onHistoryPreview?: (platform: "SWEA" | "JUNGOL" | "PROGRAMMERS") => Promise<unknown>;
  private readonly onHistoryImport?: (submissionIds: string[]) => Promise<unknown>;

  constructor(private readonly store: CaptureStore, options: DashboardBridgeOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.capabilityFactory = options.capabilityFactory ?? createUuid;
    this.idleTtlMs = options.idleTtlMs ?? SESSION_IDLE_TTL_MS;
    this.absoluteTtlMs = options.absoluteTtlMs ?? SESSION_ABSOLUTE_TTL_MS;
    this.onRelayConfigured = options.onRelayConfigured ?? (() => undefined);
    this.onHistoryPreview = options.onHistoryPreview;
    this.onHistoryImport = options.onHistoryImport;
  }

  async handleMessage(message: unknown, sender: DashboardSender): Promise<BridgeResponse> {
    if (!exactDashboardSender(sender)) return { error: "UNAUTHORIZED" };
    const identity = senderIdentity(sender);
    if (!identity) return { error: "UNAUTHORIZED" };

    const object = asObject(message);
    const type = object?.type;
    if (!isMessageType(type)) return { error: "BAD_REQUEST" };

    if (type === "CONNECT") {
      return this.connect(identity);
    }

    const capability = object?.capability;
    if (typeof capability !== "string") return { error: "UNAUTHORIZED" };
    const session = this.authorize(capability, identity);
    if (!session) return { error: "UNAUTHORIZED" };

    if (type === "PING") return { ok: true };

    if (type === "HISTORY_PREVIEW") {
      if ((object?.platform !== "SWEA" && object?.platform !== "JUNGOL" && object?.platform !== "PROGRAMMERS") || !this.onHistoryPreview) return { error: "BAD_REQUEST" };
      try { return { history: await this.onHistoryPreview(object.platform) }; }
      catch { return { error: "HISTORY_UNAVAILABLE" }; }
    }

    if (type === "HISTORY_IMPORT") {
      const ids = object?.submissionIds;
      if (object?.platform !== "JUNGOL" || !this.onHistoryImport || !Array.isArray(ids) || ids.length < 1 || ids.length > 10 ||
          ids.some(id => typeof id !== "string" || !/^\d{1,40}$/.test(id)) || new Set(ids).size !== ids.length) return { error: "BAD_REQUEST" };
      try { return { history: await this.onHistoryImport(ids as string[]) }; }
      catch { return { error: "HISTORY_UNAVAILABLE" }; }
    }

    if (type === "GET_STATUS") {
      // Counting is deliberately read-only: unlike GET_PENDING it does not
      // issue capture IDs into this capability's ACK set.
      return { pendingCount: await this.store.countPending() };
    }

    if (type === "REUSE_RELAY") {
      const accountIdValue = object?.accountId;
      const settingsVersionValue = object?.settingsVersion;
      const accountId = typeof accountIdValue === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(accountIdValue) ? accountIdValue : null;
      const settingsVersion = typeof settingsVersionValue === "number" && Number.isSafeInteger(settingsVersionValue) && settingsVersionValue >= 0 ? settingsVersionValue : null;
      if (!accountId || settingsVersion === null) return { error: "BAD_REQUEST" };
      const settings = await this.store.getSettings();
      const relay = settings.relay;
      const reusable = settings.autoSyncEnabled === true &&
        settings.accountId === accountId &&
        settings.accountSettingsVersion === settingsVersion &&
        relay?.accountId === accountId &&
        relay.generation === settingsVersion &&
        (relay.status === "CONFIRMED" || relay.status === "OFFLINE" || relay.status === "RELAY_ERROR");
      if (reusable) {
        try { this.onRelayConfigured(); } catch { /* Durable configuration remains usable. */ }
      }
      return { reused: reusable };
    }

    if (type === "CONFIGURE_RELAY") {
      const relay = object?.relay;
      const automatic = object ?? {};
      const accountId = typeof automatic.accountId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(automatic.accountId) ? automatic.accountId : undefined;
      const settingsVersion = typeof automatic.settingsVersion === "number" && Number.isSafeInteger(automatic.settingsVersion) && automatic.settingsVersion >= 0 ? automatic.settingsVersion : undefined;
      const shared = {
        ...(accountId ? { accountId } : {}),
        ...(settingsVersion !== undefined ? { accountSettingsVersion: settingsVersion } : {}),
        ...(typeof automatic.copyHeader === "boolean" ? { copyHeader: automatic.copyHeader } : {}),
        ...(typeof automatic.downloadHeader === "boolean" ? { downloadHeader: automatic.downloadHeader } : {}),
        ...(Array.isArray(automatic.copyHeaderFields) ? { copyHeaderFields: normalizedHeaderFields(automatic.copyHeaderFields) } : {}),
        ...(Array.isArray(automatic.downloadHeaderFields) ? { downloadHeaderFields: normalizedHeaderFields(automatic.downloadHeaderFields) } : {}),
        ...(typeof automatic.downloadFilenameTemplate === "string" ? { downloadFilenameTemplate: automatic.downloadFilenameTemplate } : {}),
        ...(typeof automatic.gitPathTemplate === "string" ? { gitPathTemplate: automatic.gitPathTemplate } : {}),
        ...(automatic.name === null ? { name: undefined } : typeof automatic.name === "string" ? { name: automatic.name } : {}),
        ...(automatic.nickname === null ? { nickname: undefined } : typeof automatic.nickname === "string" ? { nickname: automatic.nickname } : {}),
        ...(typeof automatic.lightTheme === "string" ? { lightTheme: automatic.lightTheme as never } : {}),
        ...(typeof automatic.darkTheme === "string" ? { darkTheme: automatic.darkTheme as never } : {})
      };
      // relay:null is not an absence of settings. It is a durable local OFF
      // plus a profile/export/theme refresh for a signed-in dashboard account.
      const apply = async (next: (current: CaptureSettings) => CaptureSettings) => {
        let stale = false;
        await this.store.mutateSettings(current => {
          // Account settings version is monotonic inside an account. A delayed
          // dashboard message must not resurrect an older relay or flags.
          if (accountId && current.accountId === accountId && settingsVersion !== undefined && current.accountSettingsVersion !== undefined && settingsVersion < current.accountSettingsVersion) { stale = true; return current; }
          return next(current);
        });
        return stale;
      };
      if (relay === null) { const stale=await apply(current => ({ ...current, ...shared, autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: automatic.githubTargetConfigured === true, relay: undefined })); return stale ? { error: "STALE_CONFIGURATION" } : { ok: true }; }
      const candidate = relay as { endpoint?: unknown; secret?: unknown; accountId?: unknown; generation?: unknown } | null;
      if (!candidate || typeof candidate.endpoint !== "string" || typeof candidate.secret !== "string" || typeof candidate.accountId !== "string" || typeof candidate.generation !== "number" || !Number.isSafeInteger(candidate.generation)) return { error: "BAD_REQUEST" };
      const endpointValue = candidate.endpoint, secret = candidate.secret, candidateAccountId = candidate.accountId, generation = candidate.generation;
      let endpoint: URL; try { endpoint = new URL(endpointValue, DASHBOARD_ORIGIN); } catch { return { error: "BAD_REQUEST" }; }
      if (!DASHBOARD_ORIGINS.includes(endpoint.origin as typeof DASHBOARD_ORIGINS[number]) || !endpoint.pathname.startsWith("/api/relay/")) return { error: "BAD_REQUEST" };
      const stale=await apply(current => ({ ...current, ...shared, relay: { endpoint: endpointValue, secret, accountId: candidateAccountId, generation, status: "CONFIRMED" }, accountId: candidateAccountId, autoSyncEnabled: automatic.autoSyncEnabled === true, githubAutoCommitEnabled: automatic.githubAutoCommitEnabled === true, githubTargetConfigured: automatic.githubTargetConfigured === true }));
      if (stale) return { error: "STALE_CONFIGURATION" };
      try { this.onRelayConfigured(); } catch { /* Durable configuration already succeeded. */ }
      return { ok: true };
    }

    if (type === "GET_PENDING") {
      const rawLimit = object?.limit;
      const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : MAX_PENDING_PAGE_SIZE;
      const captures = await this.store.listPending(session.issuedCaptureIds, Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))));
      for (const capture of captures) session.issuedCaptureIds.add(capture.captureId);
      const hasMore = captures.length === Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))) && (await this.store.countPending()) > session.issuedCaptureIds.size;
      return { captures, hasMore };
    }

    if (type === "GET_LOCAL_ARCHIVE") {
      const rawLimit = object?.limit;
      const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : MAX_PENDING_PAGE_SIZE;
      // This path is deliberately read-only. It neither issues captures for
      // ACK nor invokes relay/upload code, so a signed-out dashboard cannot
      // turn a local preview into a remote write.
      const captures = await this.store.listAll(Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))));
      return { captures, hasMore: captures.length === Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))), localOnly: true };
    }

    if (type === "GET_HISTORICAL_ARCHIVE") {
      const rawLimit = object?.limit;
      const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : MAX_PENDING_PAGE_SIZE;
      const historical = await this.store.listHistorical(Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))));
      return { ...historical, localOnly: true };
    }

    if (type === "GET_HISTORICAL_SUMMARY") {
      return { summary: await this.store.historicalSummary(), localOnly: true };
    }

    if (type === "GET_HISTORICAL_SUBMISSION_IDS") {
      if (object?.platform !== "JUNGOL") return { error: "BAD_REQUEST" };
      return { submissionIds: await this.store.listHistoricalSubmissionIds("JUNGOL"), localOnly: true };
    }

    if (type === "GET_HISTORICAL_BY_SUBMISSION_IDS") {
      const ids = object?.submissionIds;
      if (object?.platform !== "JUNGOL" || !Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PENDING_PAGE_SIZE ||
          ids.some(id => typeof id !== "string" || !/^\d{1,40}$/.test(id)) || new Set(ids).size !== ids.length) return { error: "BAD_REQUEST" };
      const captures = await this.store.listHistoricalBySubmissionIds("JUNGOL", ids as string[]);
      for (const capture of captures) session.issuedCaptureIds.add(capture.captureId);
      return { captures, totalCount: captures.length, localOnly: true };
    }

    if (type === "ACK") {
      const captureIds = object?.captureIds;
      if (!Array.isArray(captureIds) || captureIds.length > MAX_PENDING_PAGE_SIZE) {
        return { error: "BAD_REQUEST" };
      }
      const issued = captureIds.filter((captureId): captureId is string => typeof captureId === "string");
      if (issued.length !== captureIds.length || issued.some((captureId) => !session.issuedCaptureIds.has(captureId))) {
        return { error: "BAD_REQUEST" };
      }
      await this.store.markSynced(issued);
      for (const captureId of new Set(issued)) session.issuedCaptureIds.delete(captureId);
      return { ok: true };
    }

    this.sessions.delete(capability);
    return { ok: true };
  }

  activeSessionCount(): number {
    this.expireSessions(this.now());
    return this.sessions.size;
  }

  private connect(identity: SenderIdentity): BridgeResponse {
    const now = this.now();
    this.expireSessions(now);
    const capability = this.uniqueCapability();
    const session: Session = {
      capability,
      identity,
      issuedAt: now,
      lastUsedAt: now,
      issuedCaptureIds: new Set()
    };
    this.sessions.set(capability, session);
    return { capability, expiresAt: now + this.absoluteTtlMs, version: BUILD_METADATA.version, features: ["history-v1"] };
  }

  private authorize(capability: string, identity: SenderIdentity): Session | null {
    if (capability.length < 1 || capability.length > 200) return null;
    const session = this.sessions.get(capability);
    if (!session) return null;
    if (!sameIdentity(session.identity, identity)) return null;
    const now = this.now();
    if (
      now - session.lastUsedAt > this.idleTtlMs ||
      now - session.issuedAt > this.absoluteTtlMs
    ) {
      this.sessions.delete(capability);
      return null;
    }
    session.lastUsedAt = now;
    return session;
  }

  private expireSessions(now: number): void {
    for (const [capability, session] of this.sessions) {
      if (
        now - session.lastUsedAt > this.idleTtlMs ||
        now - session.issuedAt > this.absoluteTtlMs
      ) {
        this.sessions.delete(capability);
      }
    }
  }

  private uniqueCapability(): string {
    let capability = this.capabilityFactory();
    while (this.sessions.has(capability)) capability = this.capabilityFactory();
    return capability;
  }
}

export function isDashboardMessage(value: unknown): value is DashboardMessage {
  const object = asObject(value);
  if (!isMessageType(object?.type)) return false;
  if (object.type === "CONNECT") return true;
  if (typeof object.capability !== "string") return false;
  if (object.type === "ACK") return Array.isArray(object.captureIds);
  return true;
}
