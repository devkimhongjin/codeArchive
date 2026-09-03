import { describe, expect, it } from "vitest";
import type { CaptureImportRecord, CaptureSyncScope } from "../../../packages/shared-types/src";
import {
  ExtensionDashboardCaptureBridge,
  type ExternalDashboardPort,
  type ExternalDashboardSender,
} from "./dashboardCaptureBridge";
import type { CaptureBridgePage, CaptureBridgeRepository, CaptureBridgeSummary } from "./solutionRepository";

const ORIGIN = "https://dashboard.example.com";
const SYNC_SESSION_ID = "sync-session-a";

function record(id: string, code = `source-${id}`): CaptureImportRecord {
  return {
    clientRecordId: id,
    problem: {
      platform: "SWEA",
      platformProblemId: id,
      problemNumber: id,
      title: `Title ${id}`,
      url: `https://swexpertacademy.com/problem/${id}`,
      tags: [],
    },
    language: "JAVA",
    code,
    result: "ACCEPTED",
    submittedAt: "2026-08-28T00:00:00.000Z",
  };
}

class MemoryRepository implements CaptureBridgeRepository {
  readonly records: CaptureImportRecord[];
  readonly acknowledged = new Set<string>();
  readonly receipts: Array<{ ids: readonly string[]; importBatchId: string; importedAt: string }> = [];
  revision = 7;

  constructor(records: CaptureImportRecord[]) {
    this.records = [...records];
  }

  async summary(): Promise<CaptureBridgeSummary> {
    return {
      pendingCount: this.records.filter((item) => !this.acknowledged.has(item.clientRecordId)).length,
      allCount: this.records.length,
      revision: this.revision,
    };
  }

  async page(scope: CaptureSyncScope, cursor: string | undefined, limit: number): Promise<CaptureBridgePage> {
    let start = 0;
    if (cursor) {
      const index = this.records.findIndex((item) => item.clientRecordId === cursor);
      if (index < 0) throw new Error("invalid test cursor");
      start = index + 1;
    }
    const eligible = (item: CaptureImportRecord) => scope === "all" || !this.acknowledged.has(item.clientRecordId);
    const selected = this.records.slice(start).filter(eligible).slice(0, limit);
    const last = selected.at(-1);
    let nextCursor: string | undefined;
    if (last) {
      const lastIndex = this.records.findIndex((item) => item.clientRecordId === last.clientRecordId);
      if (this.records.slice(lastIndex + 1).some(eligible)) nextCursor = last.clientRecordId;
    }
    return { records: selected, ...(nextCursor ? { nextCursor } : {}), revision: this.revision };
  }

  async acknowledge(clientRecordIds: readonly string[], importBatchId: string, importedAt: string): Promise<readonly string[]> {
    this.receipts.push({ ids: [...clientRecordIds], importBatchId, importedAt });
    for (const id of clientRecordIds) this.acknowledged.add(id);
    this.revision += 1;
    return [...clientRecordIds];
  }
}

class FakePort implements ExternalDashboardPort {
  sender?: ExternalDashboardSender;
  readonly posted: any[] = [];
  disconnected = false;
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];

  constructor(sender: ExternalDashboardSender = { origin: ORIGIN, url: `${ORIGIN}/sync`, tab: { id: 11 } }) {
    this.sender = sender;
  }

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => { this.messageListeners.push(listener); },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => { this.disconnectListeners.push(listener); },
  };

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.disconnectListeners) listener();
  }

  async send(message: unknown): Promise<any> {
    const before = this.posted.length;
    for (const listener of this.messageListeners) listener(message);
    for (let i = 0; i < 20 && this.posted.length === before; i += 1) await Promise.resolve();
    if (this.posted.length === before) throw new Error("bridge did not respond");
    return this.posted.at(-1);
  }
}

async function begin(port: FakePort): Promise<string> {
  const session = await port.send({
    type: "CODEARCHIVE_SYNC_SESSION_START",
    protocolVersion: 1,
    syncSessionId: SYNC_SESSION_ID,
    authenticated: true,
    autoSyncConsent: true,
  });
  expect(session.ok).toBe(true);
  const response = await port.send({
    type: "CODEARCHIVE_IMPORT_BEGIN",
    protocolVersion: 1,
    syncSessionId: SYNC_SESSION_ID,
  });
  expect(response.ok).toBe(true);
  return response.data.capability as string;
}

async function page(port: FakePort, capability: string, scope: CaptureSyncScope = "pending", cursor?: string, limit = 25): Promise<any> {
  return port.send({ type: "CODEARCHIVE_CAPTURE_PAGE", protocolVersion: 1, capability, scope, limit, ...(cursor ? { cursor } : {}) });
}

describe("ExtensionDashboardCaptureBridge", () => {
  it("accepts only the exact HTTPS sender origin/url/tab context", () => {
    const bridge = new ExtensionDashboardCaptureBridge(new MemoryRepository([]));
    const allowed = new FakePort();
    expect(bridge.connect(allowed, ORIGIN)).toBe(true);
    expect(allowed.disconnected).toBe(false);

    const wrongOrigin = new FakePort({ origin: "https://evil.example", url: `${ORIGIN}/sync`, tab: { id: 11 } });
    expect(bridge.connect(wrongOrigin, ORIGIN)).toBe(false);
    expect(wrongOrigin.disconnected).toBe(true);

    const insecure = new FakePort({ origin: "http://dashboard.example.com", url: "http://dashboard.example.com/sync", tab: { id: 11 } });
    expect(bridge.connect(insecure, "http://dashboard.example.com")).toBe(false);
    expect(insecure.disconnected).toBe(true);
  });

  it("fails closed and invalidates every source capability when a second Dashboard tab connects", async () => {
    const bridge = new ExtensionDashboardCaptureBridge(new MemoryRepository([record("a")]), () => 0, () => "cap-a");
    const first = new FakePort();
    bridge.connect(first, ORIGIN);
    const capability = await begin(first);

    const second = new FakePort({ origin: ORIGIN, url: `${ORIGIN}/other`, tab: { id: 12 } });
    bridge.connect(second, ORIGIN);
    expect(first.posted).toContainEqual({ type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "MULTIPLE_DASHBOARD_TABS" });
    expect(second.posted).toContainEqual({ type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "MULTIPLE_DASHBOARD_TABS" });
    expect(bridge.getAutomationState()).toMatchObject({ connectionAvailable: false, errorCode: "MULTIPLE_DASHBOARD_TABS" });
    await expect(page(first, capability)).resolves.toEqual({ ok: false, error: { code: "CAPABILITY_INVALID", retryable: false } });
  });

  it("returns fixed safe envelopes for malformed, unsupported and capability-less requests", async () => {
    const bridge = new ExtensionDashboardCaptureBridge(new MemoryRepository([]));
    const port = new FakePort();
    bridge.connect(port, ORIGIN);

    await expect(port.send({})).resolves.toEqual({ ok: false, error: { code: "INVALID_REQUEST", retryable: false } });
    await expect(port.send({ type: "CODEARCHIVE_PING", protocolVersion: 2 })).resolves.toEqual({ ok: false, error: { code: "UNSUPPORTED_PROTOCOL", retryable: false } });
    await expect(port.send({ type: "CODEARCHIVE_CAPTURE_PAGE", protocolVersion: 1, limit: 1, scope: "pending" })).resolves.toEqual({ ok: false, error: { code: "CAPABILITY_REQUIRED", retryable: false } });
  });

  it("refuses source capability before an authenticated, consented sync session", async () => {
    const bridge = new ExtensionDashboardCaptureBridge(new MemoryRepository([]));
    const port = new FakePort();
    bridge.connect(port, ORIGIN);

    await expect(port.send({
      type: "CODEARCHIVE_IMPORT_BEGIN",
      protocolVersion: 1,
      syncSessionId: SYNC_SESSION_ID,
    })).resolves.toEqual({ ok: false, error: { code: "SYNC_NOT_ELIGIBLE", retryable: false } });
    await expect(port.send({
      type: "CODEARCHIVE_SYNC_SESSION_START",
      protocolVersion: 1,
      syncSessionId: SYNC_SESSION_ID,
      authenticated: true,
      autoSyncConsent: false,
    })).resolves.toEqual({ ok: false, error: { code: "SYNC_NOT_ELIGIBLE", retryable: false } });
  });

  it("invalidates eligibility and capability on logout, consent withdrawal, or account switch", async () => {
    const bridge = new ExtensionDashboardCaptureBridge(new MemoryRepository([record("a")]), () => 0, () => "cap-a");
    const port = new FakePort();
    bridge.connect(port, ORIGIN);
    const capability = await begin(port);

    await expect(port.send({
      type: "CODEARCHIVE_SYNC_SESSION_END",
      protocolVersion: 1,
      syncSessionId: SYNC_SESSION_ID,
    })).resolves.toEqual({ ok: true, data: { protocolVersion: 1, syncSessionId: SYNC_SESSION_ID } });
    await expect(page(port, capability)).resolves.toEqual({ ok: false, error: { code: "CAPABILITY_INVALID", retryable: false } });
    await expect(port.send({
      type: "CODEARCHIVE_IMPORT_BEGIN",
      protocolVersion: 1,
      syncSessionId: SYNC_SESSION_ID,
    })).resolves.toEqual({ ok: false, error: { code: "SYNC_NOT_ELIGIBLE", retryable: false } });
  });

  it("keeps summary and capture-changed strictly metadata-only and does not auto-push source", async () => {
    const repository = new MemoryRepository([record("a")]);
    const bridge = new ExtensionDashboardCaptureBridge(repository, () => 0, () => "cap-a");
    const port = new FakePort();
    bridge.connect(port, ORIGIN);

    const summary = await port.send({ type: "CODEARCHIVE_CAPTURE_SUMMARY", protocolVersion: 1 });
    expect(summary).toEqual({ ok: true, data: { protocolVersion: 1, pendingCount: 1, allCount: 1, revision: 7 } });
    expect(JSON.stringify(summary)).not.toMatch(/source-a|Title a|swexpertacademy|account|token|cookie/i);

    await bridge.notifyCaptureChanged();
    expect(port.posted).toHaveLength(1);

    await begin(port);
    const before = port.posted.length;
    await bridge.notifyCaptureChanged();
    expect(port.posted).toHaveLength(before + 1);
    const event = port.posted.at(-1);
    expect(event).toEqual({ type: "CODEARCHIVE_CAPTURE_CHANGED", protocolVersion: 1, pendingCount: 1, revision: 7 });
    expect(Object.keys(event).sort()).toEqual(["pendingCount", "protocolVersion", "revision", "type"]);
    expect(JSON.stringify(event)).not.toMatch(/source-a|Title a|swexpertacademy|account|token|cookie/i);
  });

  it("supports pending pagination while all remains an explicit requested recovery scope", async () => {
    const repository = new MemoryRepository([record("a"), record("b"), record("c")]);
    repository.acknowledged.add("a");
    const bridge = new ExtensionDashboardCaptureBridge(repository, () => 0, () => "cap-a");
    const port = new FakePort();
    bridge.connect(port, ORIGIN);
    const capability = await begin(port);

    const firstPending = await page(port, capability, "pending", undefined, 1);
    expect(firstPending.data.records.map((item: CaptureImportRecord) => item.clientRecordId)).toEqual(["b"]);
    expect(firstPending.data.nextCursor).toBe("b");
    const secondPending = await page(port, capability, "pending", firstPending.data.nextCursor, 1);
    expect(secondPending.data.records.map((item: CaptureImportRecord) => item.clientRecordId)).toEqual(["c"]);

    const all = await page(port, capability, "all", undefined, 25);
    expect(all.data.records.map((item: CaptureImportRecord) => item.clientRecordId)).toEqual(["a", "b", "c"]);
  });

  it("ACKs only IDs offered by the active capability, records receipt metadata, and retains local records", async () => {
    let now = Date.parse("2026-08-28T00:00:00.000Z");
    const repository = new MemoryRepository([record("a"), record("b")]);
    const bridge = new ExtensionDashboardCaptureBridge(repository, () => now, () => "cap-a");
    const port = new FakePort();
    bridge.connect(port, ORIGIN);
    const capability = await begin(port);

    await page(port, capability, "pending", undefined, 1);
    await expect(port.send({ type: "CODEARCHIVE_CAPTURE_ACK", protocolVersion: 1, capability, importBatchId: "batch-1", clientRecordIds: ["b"] }))
      .resolves.toEqual({ ok: false, error: { code: "ACK_NOT_OFFERED", retryable: false } });

    now += 1000;
    const ack = await port.send({ type: "CODEARCHIVE_CAPTURE_ACK", protocolVersion: 1, capability, importBatchId: "batch-1", clientRecordIds: ["a"] });
    expect(ack).toEqual({
      ok: true,
      data: {
        protocolVersion: 1,
        importBatchId: "batch-1",
        acknowledgedAt: "2026-08-28T00:00:01.000Z",
        acknowledgedClientRecordIds: ["a"],
      },
    });
    expect(repository.receipts).toHaveLength(1);
    expect(repository.records).toHaveLength(2);
    expect((await repository.summary()).pendingCount).toBe(1);
  });

  it("invalidates capability on idle expiry, disconnect and reconnect replay", async () => {
    let now = 0;
    const repository = new MemoryRepository([record("a")]);
    const bridge = new ExtensionDashboardCaptureBridge(repository, () => now, () => "cap-a");
    const first = new FakePort();
    bridge.connect(first, ORIGIN);
    const capability = await begin(first);

    now = 2 * 60 * 1000;
    await expect(page(first, capability)).resolves.toEqual({ ok: false, error: { code: "CAPABILITY_EXPIRED", retryable: true } });

    const second = new FakePort();
    bridge.connect(second, ORIGIN);
    const secondCapability = await begin(second);
    second.disconnect();

    const reconnect = new FakePort();
    bridge.connect(reconnect, ORIGIN);
    await expect(page(reconnect, secondCapability)).resolves.toEqual({ ok: false, error: { code: "CAPABILITY_INVALID", retryable: false } });
  });

  it("enforces page/request/response limits and never offers an oversized response", async () => {
    const huge = record("huge", "x".repeat(1024 * 1024));
    const repository = new MemoryRepository([huge]);
    const bridge = new ExtensionDashboardCaptureBridge(repository, () => 0, () => "cap-a");
    const port = new FakePort();
    bridge.connect(port, ORIGIN);
    const capability = await begin(port);

    await expect(page(port, capability, "pending", undefined, 26)).resolves.toEqual({ ok: false, error: { code: "INVALID_REQUEST", retryable: false } });
    await expect(page(port, capability)).resolves.toEqual({ ok: false, error: { code: "PAYLOAD_LIMIT_EXCEEDED", retryable: false } });
    await expect(port.send({ type: "CODEARCHIVE_CAPTURE_ACK", protocolVersion: 1, capability, importBatchId: "batch", clientRecordIds: ["huge"] }))
      .resolves.toEqual({ ok: false, error: { code: "ACK_NOT_OFFERED", retryable: false } });

    const smallRepository = new MemoryRepository([]);
    const limited = new ExtensionDashboardCaptureBridge(smallRepository, () => 0, () => "cap-b");
    const limitedPort = new FakePort();
    limited.connect(limitedPort, ORIGIN);
    const limitedCapability = await begin(limitedPort);
    for (let i = 0; i < 100; i += 1) {
      const response = await page(limitedPort, limitedCapability, "pending", undefined, 1);
      expect(response.ok).toBe(true);
    }
    await expect(page(limitedPort, limitedCapability, "pending", undefined, 1)).resolves.toEqual({ ok: false, error: { code: "REQUEST_LIMIT_EXCEEDED", retryable: true } });
  });
});
