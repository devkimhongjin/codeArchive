import { describe, expect, it, vi } from "vitest";
import { RELAY_DRAIN_ALARM, RelayRuntime, type RelayAlarmApi, type RelayFetchResponse } from "./relayRuntime";
import type { RelayStateRecord, RelayStateRepository } from "./relayState";
import type { SolutionRecord } from "../solution";
import type { CodeArchiveAutomationState } from "../../../../packages/shared-types/src";
import { ExtensionDashboardCaptureBridge, type ExternalDashboardPort, type ExternalDashboardSender } from "../dashboardCaptureBridge";
import type { CaptureBridgePage, CaptureBridgeRepository, CaptureBridgeSummary } from "../solutionRepository";

function state(overrides: Partial<RelayStateRecord> = {}): RelayStateRecord {
  return {
    deviceId: "device-1234567890",
    publicKey: "public-key",
    privateKey: {} as CryptoKey,
    revision: 0,
    state: "ACTIVE",
    grantId: "grant-1234",
    credential: "credential",
    generation: 7,
    expiresAt: new Date(2_000_000).toISOString(),
    autoSyncEnabled: true,
    failureCount: 0,
    ...overrides,
  };
}

function record(id: string, generation = 7): SolutionRecord {
  return {
    id,
    clientRecordId: id,
    platform: "SWEA",
    problemNumber: "1234",
    title: "title",
    language: "Java",
    code: "class Main {}",
    solvedAt: "1970-01-01",
    aiUsage: "unknown",
    createdAt: "1970-01-01T00:00:01.000Z",
    updatedAt: "1970-01-01T00:00:01.000Z",
    performance: { executionTime: "78 ms", memoryUsage: "25,472 kb" },
    autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "1970-01-01T00:00:01.000Z" },
    relayCapture: { generation, capturedAt: "1970-01-01T00:00:01.000Z" },
  };
}

class MemoryState implements RelayStateRepository {
  constructor(public value: RelayStateRecord) {}
  async get(): Promise<RelayStateRecord> { return this.value; }
  async update(mutate: (current: RelayStateRecord) => RelayStateRecord): Promise<RelayStateRecord> {
    this.value = { ...mutate(this.value), revision: this.value.revision + 1 };
    return this.value;
  }
}

class MemoryAlarms implements RelayAlarmApi {
  readonly created: number[] = [];
  readonly cleared: string[] = [];
  private listener?: (alarm: { name: string }) => void;
  create(_name: string, info: { when: number }): void { this.created.push(info.when); }
  clear(name: string): boolean { this.cleared.push(name); return true; }
  onAlarm = { addListener: (listener: (alarm: { name: string }) => void) => { this.listener = listener; } };
  fire(): void { this.listener?.({ name: RELAY_DRAIN_ALARM }); }
}

class DisconnectPort implements ExternalDashboardPort {
  sender?: ExternalDashboardSender = { origin: "https://dashboard.example.com", url: "https://dashboard.example.com/", tab: { id: 1 } };
  readonly onMessage = { addListener: (_listener: (message: unknown) => void) => undefined };
  readonly onDisconnect = { addListener: (listener: () => void) => { this.listener = listener; } };
  private listener?: () => void;
  postMessage(_message: unknown): void { /* no-op for lifecycle-only regression */ }
  disconnect(): void { this.listener?.(); }
}

class EmptyCaptureBridgeRepository implements CaptureBridgeRepository {
  async summary(): Promise<CaptureBridgeSummary> { return { pendingCount: 0, allCount: 0, revision: 0 }; }
  async page(): Promise<CaptureBridgePage> { return { records: [], revision: 0 }; }
  async acknowledge(): Promise<readonly string[]> { return []; }
}

async function waitForRequest(requests: readonly RequestInit[]): Promise<void> {
  await vi.waitFor(() => expect(requests).toHaveLength(1));
}

function response(results: unknown[], status = 200, retryAfter?: string): RelayFetchResponse {
  return { status, headers: { get: (name) => name.toLowerCase() === "retry-after" ? retryAfter ?? null : null }, json: async () => ({ success: true, data: { results } }) };
}

describe("RelayRuntime", () => {
  const enabledState: CodeArchiveAutomationState = {
    protocolVersion: 1,
    autoSyncEnabled: true,
    githubAutoCommitEnabled: false,
    githubTargetConfigured: false,
    authenticated: true,
    connectionAvailable: true,
    errorCode: null,
  };

  it("posts only current-generation captures and ACKs imported records", async () => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    const imported: string[][] = [];
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("fresh"), record("stale", 6)],
      markImported: async (ids) => { imported.push([...ids]); },
      fetch: async (_input, init) => { requests.push(init); return response([{ clientRecordId: "fresh", outcome: "IMPORTED", ackEligible: true, errorCode: null }]); },
    });

    await runtime.drain();

    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0].body)).records).toHaveLength(1);
    expect(requests[0].headers).toMatchObject({ Authorization: "Bearer credential" });
    expect(JSON.parse(String(requests[0].body)).records[0].solvedAt).toBe("1969-12-31T15:00:00.000Z");
    expect(imported).toEqual([["fresh"]]);
  });

  it("fails closed locally when AUTO_SYNC is OFF without making a request", async () => {
    const stateRepo = new MemoryState(state({ autoSyncEnabled: false }));
    let called = false;
    const runtime = new RelayRuntime({ now: () => 1_000_000, state: stateRepo, listPending: async () => [record("one")], fetch: async () => { called = true; return response([]); } });

    await runtime.drain();

    expect(called).toBe(false);
    expect(stateRepo.value.credential).toBe("credential");
  });

  it("erases the credential on an invalid-grant response", async () => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const runtime = new RelayRuntime({ now: () => 1_000_000, state: stateRepo, alarms, listPending: async () => [record("one")], fetch: async () => response([], 401) });

    await runtime.drain();

    expect(stateRepo.value.credential).toBeUndefined();
    expect(stateRepo.value.state).toBe("EXPIRED");
    expect(alarms.cleared).toContain(RELAY_DRAIN_ALARM);
  });

  it("moves AUTO_SYNC OFF to revocation-pending without retaining the credential", async () => {
    const stateRepo = new MemoryState(state());
    const runtime = new RelayRuntime({ state: stateRepo, alarms: new MemoryAlarms(), now: () => 1_000_000 });

    await runtime.onAutomationState({ ...enabledState, autoSyncEnabled: false });

    expect(stateRepo.value.state).toBe("REVOCATION_PENDING");
    expect(stateRepo.value.credential).toBeUndefined();
    expect(stateRepo.value.grantId).toBe("grant-1234");
    expect(stateRepo.value.generation).toBe(7);
  });

  it("keeps an ACTIVE durable relay armed when the Dashboard controller disappears", async () => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const runtime = new RelayRuntime({ state: stateRepo, alarms, now: () => 1_000_000 });

    await runtime.onAutomationState({
      ...enabledState,
      autoSyncEnabled: false,
      githubAutoCommitEnabled: false,
      authenticated: false,
      connectionAvailable: false,
      errorCode: "DASHBOARD_DISCONNECTED",
    });

    expect(stateRepo.value.state).toBe("ACTIVE");
    expect(stateRepo.value.credential).toBe("credential");
    expect(stateRepo.value.generation).toBe(7);
    expect(stateRepo.value.autoSyncEnabled).toBe(true);
    expect(alarms.cleared).toHaveLength(0);

    await runtime.onCaptureCommitted();

    expect(alarms.created.at(-1)).toBe(1_000_000);
  });

  it("drains the real save orchestration after an external Port disconnect without a Dashboard", async () => {
    (globalThis as any).chrome = {
      runtime: {
        onMessage: { addListener: () => undefined },
        onConnectExternal: { addListener: () => undefined },
      },
    };
    const { saveThenSyncAcceptedCapture } = await import("../background");
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("after-disconnect")],
      fetch: async (_input, init) => {
        requests.push(init);
        return response([{ clientRecordId: "after-disconnect", outcome: "IMPORTED", ackEligible: true, errorCode: null }]);
      },
    });
    const bridge = new ExtensionDashboardCaptureBridge(new EmptyCaptureBridgeRepository(), () => 1_000_000, () => "cap", undefined, runtime);
    const port = new DisconnectPort();
    expect(bridge.connect(port, "https://dashboard.example.com")).toBe(true);
    port.disconnect();

    const capture = {
      captureId: "after-disconnect",
      platform: "SWEA" as const,
      result: "ACCEPTED" as const,
      problemNumber: "1234",
      title: "title",
      language: "Java",
      code: "class Main {}",
      observedAt: "1970-01-01T00:00:01.000Z",
      solvedAt: "1970-01-01",
    };
    const result = await saveThenSyncAcceptedCapture(capture, {
      saveCapture: async () => ({ status: "saved" as const, solutionId: "swea-auto:after-disconnect", savedAt: "1970-01-01T00:00:01.000Z" }),
      onCaptureCommitted: () => runtime.onCaptureCommitted(),
    });

    expect(result.status).toBe("saved");
    expect(stateRepo.value.state).toBe("ACTIVE");
    expect(stateRepo.value.credential).toBe("credential");
    expect(alarms.created.at(-1)).toBe(1_000_000);
    await waitForRequest(requests);
    expect(JSON.parse(String(requests[0]?.body)).records[0].clientRecordId).toBe("after-disconnect");
  });

  it("does not erase a valid grant solely for a multiple-tab safety stop", async () => {
    const stateRepo = new MemoryState(state());
    const runtime = new RelayRuntime({ state: stateRepo, alarms: new MemoryAlarms(), now: () => 1_000_000 });

    await runtime.onAutomationState({ ...enabledState, errorCode: "MULTIPLE_DASHBOARD_TABS" });

    expect(stateRepo.value.state).toBe("ACTIVE");
    expect(stateRepo.value.credential).toBe("credential");
  });

  it("records CONFLICT as terminal and never retries it", async () => {
    const stateRepo = new MemoryState(state());
    const conflicts: string[][] = [];
    const alarms = new MemoryAlarms();
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("conflict")],
      markConflicts: async (ids) => { conflicts.push([...ids]); },
      fetch: async () => response([{ clientRecordId: "conflict", outcome: "CONFLICT", ackEligible: false, errorCode: "CLIENT_RECORD_CONFLICT" }]),
    });

    await runtime.drain();

    expect(conflicts).toEqual([["conflict"]]);
    expect(alarms.created).toHaveLength(0);
  });

  it("does not send an oversized record and marks it terminal", async () => {
    const stateRepo = new MemoryState(state());
    const conflicts: Array<{ ids: string[]; errorCode?: string }> = [];
    let called = false;
    const oversized = { ...record("oversized"), code: "x".repeat(200_001) };
    const runtime = new RelayRuntime({
      state: stateRepo,
      now: () => 1_000_000,
      listPending: async () => [oversized],
      markInvalid: async (records, _at, errorCode) => { conflicts.push({ ids: records.map((record) => record.clientRecordId!), errorCode }); },
      fetch: async () => { called = true; return response([]); },
    });

    await runtime.drain();

    expect(called).toBe(false);
    expect(conflicts).toEqual([{ ids: ["oversized"], errorCode: "RELAY_RECORD_TOO_LARGE" }]);
  });

  it.each([
    ["blank problem number", { problemNumber: "   " }],
    ["invalid solved timestamp", { solvedAt: "not-a-date" }],
    ["invalid observed timestamp", { autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "not-a-date" } }],
    ["future captured timestamp", { relayCapture: { generation: 7, capturedAt: new Date(1_400_001).toISOString() } }],
    ["invalid AI usage", { aiUsage: "maybe" as never }],
  ])("isolates %s without invalidating the grant", async (_label, changes) => {
    const stateRepo = new MemoryState(state());
    const invalid: string[] = [];
    let called = false;
    const runtime = new RelayRuntime({
      state: stateRepo,
      now: () => 1_000_000,
      listPending: async () => [{ ...record("invalid"), ...changes } as SolutionRecord],
      markInvalid: async (records) => { invalid.push(...records.map((record) => record.id)); },
      fetch: async () => { called = true; return response([]); },
    });

    await runtime.drain();

    expect(called).toBe(false);
    expect(invalid).toEqual(["invalid"]);
    expect(stateRepo.value.credential).toBe("credential");
  });

  it("uses the greater of local backoff and Retry-After, including HTTP-date", async () => {
    const now = 1_000_000;
    const stateRepo = new MemoryState(state({ failureCount: 3 }));
    const alarms = new MemoryAlarms();
    const runtime = new RelayRuntime({ state: stateRepo, alarms, now: () => now, listPending: async () => [record("one")], fetch: async () => response([], 429, "120") });

    await runtime.drain();

    expect(alarms.created.at(-1)).toBe(now + 1_800_000);
    const later = new Date(now + 2_400_000).toUTCString();
    const laterRuntime = new RelayRuntime({ state: new MemoryState(state({ failureCount: 1 })), alarms: new MemoryAlarms(), now: () => now, listPending: async () => [record("two")], fetch: async () => response([], 429, later) });
    await laterRuntime.drain();
    expect((laterRuntime as unknown as { alarms: MemoryAlarms }).alarms.created.at(-1)).toBe(now + 2_400_000);

    const shortRetryRuntime = new RelayRuntime({
      state: new MemoryState(state({ failureCount: 1 })),
      alarms: new MemoryAlarms(),
      now: () => now,
      listPending: async () => [record("short-retry")],
      fetch: async () => response([], 429, "10"),
    });
    await shortRetryRuntime.drain();
    expect((shortRetryRuntime as unknown as { alarms: MemoryAlarms }).alarms.created.at(-1)).toBe(now + 180_000);

    const invalidRetryRuntime = new RelayRuntime({
      state: new MemoryState(state({ failureCount: 2 })),
      alarms: new MemoryAlarms(),
      now: () => now,
      listPending: async () => [record("invalid-retry")],
      fetch: async () => response([], 429, "not-a-delay"),
    });
    await invalidRetryRuntime.drain();
    expect((invalidRetryRuntime as unknown as { alarms: MemoryAlarms }).alarms.created.at(-1)).toBe(now + 600_000);
  });

  it("serializes overlapping alarm invocations", async () => {
    const stateRepo = new MemoryState(state());
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new RelayRuntime({
      state: stateRepo,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      markImported: async () => undefined,
      fetch: async () => { calls += 1; await pending; return response([{ clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null }]); },
    });
    const first = runtime.drain();
    const second = runtime.drain();
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });
});
