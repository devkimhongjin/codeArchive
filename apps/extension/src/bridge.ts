import { createUuid } from "./capture";
import type { Capture } from "./types";
import type { CaptureStore } from "./storage";

export const DASHBOARD_ORIGIN = "http://localhost:5173";
export const SESSION_IDLE_TTL_MS = 5 * 60 * 1_000;
export const SESSION_ABSOLUTE_TTL_MS = 15 * 60 * 1_000;
export const MAX_PENDING_PAGE_SIZE = 50;

export type DashboardMessage =
  | { type: "CONNECT" }
  | { type: "PING"; capability: string }
  | { type: "GET_PENDING"; capability: string; limit?: number }
  | { type: "ACK"; capability: string; captureIds: string[] }
  | { type: "DISCONNECT"; capability: string };

export interface DashboardSender {
  url?: string;
  documentId?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

export type BridgeResponse =
  | { capability: string; expiresAt: number }
  | { captures: Capture[]; hasMore: boolean }
  | { ok: true }
  | { error: "UNAUTHORIZED" | "BAD_REQUEST" };

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
}

function exactDashboardSender(sender: DashboardSender): boolean {
  if (typeof sender.url !== "string") return false;
  try {
    if (new URL(sender.url).origin !== DASHBOARD_ORIGIN) return false;
    if (sender.tab?.url && new URL(sender.tab.url).origin !== DASHBOARD_ORIGIN) return false;
    return true;
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
  return value === "CONNECT" || value === "PING" || value === "GET_PENDING" || value === "ACK" || value === "DISCONNECT";
}

export class DashboardBridge {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly capabilityFactory: () => string;
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;

  constructor(private readonly store: CaptureStore, options: DashboardBridgeOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.capabilityFactory = options.capabilityFactory ?? createUuid;
    this.idleTtlMs = options.idleTtlMs ?? SESSION_IDLE_TTL_MS;
    this.absoluteTtlMs = options.absoluteTtlMs ?? SESSION_ABSOLUTE_TTL_MS;
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

    if (type === "GET_PENDING") {
      const rawLimit = object?.limit;
      const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : MAX_PENDING_PAGE_SIZE;
      const captures = await this.store.listPending(session.issuedCaptureIds, Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))));
      for (const capture of captures) session.issuedCaptureIds.add(capture.captureId);
      const hasMore = captures.length === Math.min(MAX_PENDING_PAGE_SIZE, Math.max(1, Math.floor(limit))) && (await this.store.countPending()) > session.issuedCaptureIds.size;
      return { captures, hasMore };
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
    return { capability, expiresAt: now + this.absoluteTtlMs };
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
