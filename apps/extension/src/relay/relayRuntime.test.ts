import { describe, expect, it, vi } from "vitest";
import { RELAY_DRAIN_ALARM, RelayRuntime, type RelayAlarmApi, type RelayFetchResponse } from "./relayRuntime";
import type { RelayStateRecord, RelayStateRepository } from "./relayState";
import type { SolutionRecord } from "../solution";
import type { CodeArchiveAutomationState } from "../../../../packages/shared-types/src";
import { ExtensionDashboardCaptureBridge, type ExternalDashboardPort, type ExternalDashboardSender } from "../dashboardCaptureBridge";
import {
  indexedDbSolutionRepository,
  listRelayPendingCaptures,
  openCodeArchiveDatabase,
  RELAY_STATE_KEY,
  RELAY_STATE_STORE_NAME,
  saveAcceptedCapture,
  type CaptureBridgePage,
  type CaptureBridgeRepository,
  type CaptureBridgeSummary,
} from "../solutionRepository";

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

function record(id: string, generation = 7, grantId = "grant-1234"): SolutionRecord {
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
    relayCapture: { grantId, generation, capturedAt: "1970-01-01T00:00:01.000Z" },
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

class DeferredReadState extends MemoryState {
  private firstRead = true;
  private releaseFirstRead?: () => void;
  private readonly readStartedPromise: Promise<void>;
  private signalReadStarted!: () => void;
  readonly readStarted: Promise<void>;

  constructor(value: RelayStateRecord) {
    super(value);
    this.readStartedPromise = new Promise((resolve) => { this.signalReadStarted = resolve; });
    this.readStarted = this.readStartedPromise;
  }

  override get(): Promise<RelayStateRecord> {
    if (!this.firstRead) return super.get();
    this.firstRead = false;
    this.signalReadStarted();
    const snapshot = this.value;
    return new Promise((resolve) => { this.releaseFirstRead = () => resolve(snapshot); });
  }

  releaseFirstReadWith(next: RelayStateRecord): void {
    this.value = next;
    this.releaseFirstRead?.();
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

type MemoryStoreData = { keyPath?: string; values: Map<IDBValidKey, unknown> };

class MemoryIndexedDbTransaction {
  private pending = 0;
  private completeListener?: () => void;
  private completionQueued = false;
  onerror?: () => void;
  onabort?: () => void;

  set oncomplete(listener: (() => void) | undefined) {
    this.completeListener = listener;
    this.maybeComplete();
  }

  get oncomplete(): (() => void) | undefined {
    return this.completeListener;
  }

  constructor(private readonly db: MemoryIndexedDbDatabase) {}

  objectStore(name: string): MemoryIndexedDbStore {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`Missing memory store: ${name}`);
    return new MemoryIndexedDbStore(this, store);
  }

  request<T>(work: () => T): any {
    this.pending += 1;
    const request: any = { result: undefined, error: null, onsuccess: undefined, onerror: undefined };
    queueMicrotask(() => {
      try {
        request.result = work();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
      } finally {
        this.pending -= 1;
        this.maybeComplete();
      }
    });
    return request;
  }

  private maybeComplete(): void {
    if (this.pending !== 0 || !this.completeListener || this.completionQueued) return;
    this.completionQueued = true;
    queueMicrotask(() => this.completeListener?.());
  }
}

class MemoryIndexedDbStore {
  readonly indexNames = { contains: (_name: string) => false };

  constructor(private readonly transaction: MemoryIndexedDbTransaction, private readonly data: MemoryStoreData) {}

  createIndex(_name: string, _keyPath: string): void { /* schema-only for the repository contract */ }

  private key(value: any, key?: IDBValidKey): IDBValidKey {
    return key ?? (this.data.keyPath ? value[this.data.keyPath] : undefined);
  }

  get(key: IDBValidKey): any { return this.transaction.request(() => this.data.values.get(key)); }
  getAll(): any { return this.transaction.request(() => [...this.data.values.values()]); }
  add(value: any): any {
    return this.transaction.request(() => {
      const key = this.key(value);
      if (key === undefined || this.data.values.has(key)) throw new Error("ConstraintError");
      this.data.values.set(key, value);
      return undefined;
    });
  }
  put(value: any, key?: IDBValidKey): any {
    return this.transaction.request(() => {
      const resolved = this.key(value, key);
      if (resolved === undefined) throw new Error("DataError");
      this.data.values.set(resolved, value);
      return undefined;
    });
  }
  delete(key: IDBValidKey): any {
    return this.transaction.request(() => { this.data.values.delete(key); return undefined; });
  }
  openCursor(): any { return this.transaction.request(() => null); }
}

class MemoryIndexedDbDatabase {
  readonly stores = new Map<string, MemoryStoreData>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  close(): void { /* no-op */ }
  createObjectStore(name: string, options?: { keyPath?: string }): MemoryIndexedDbStore {
    const data: MemoryStoreData = { keyPath: options?.keyPath, values: new Map() };
    this.stores.set(name, data);
    return new MemoryIndexedDbStore(new MemoryIndexedDbTransaction(this), data);
  }
  transaction(names: string | readonly string[], _mode: IDBTransactionMode): MemoryIndexedDbTransaction {
    const requested = Array.isArray(names) ? names : [names];
    requested.forEach((name) => { if (!this.stores.has(name)) throw new Error(`Missing memory store: ${name}`); });
    return new MemoryIndexedDbTransaction(this);
  }
}

class MemoryIndexedDbFactory {
  readonly database = new MemoryIndexedDbDatabase();
  private initialized = false;

  open(): any {
    const request: any = { result: this.database, transaction: undefined, onsuccess: undefined, onerror: undefined, onupgradeneeded: undefined };
    queueMicrotask(() => {
      if (!this.initialized) {
        this.initialized = true;
        request.transaction = new MemoryIndexedDbTransaction(this.database);
        request.onupgradeneeded?.({ oldVersion: 0, newVersion: 3, target: request });
      }
      queueMicrotask(() => request.onsuccess?.({ target: request }));
    });
    return request;
  }

  async seedRelayState(value: unknown): Promise<void> {
    if (!this.initialized) await new Promise<void>((resolve) => queueMicrotask(resolve));
    this.database.stores.get(RELAY_STATE_STORE_NAME)?.values.set(RELAY_STATE_KEY, value);
  }
}

async function waitForRequest(requests: readonly RequestInit[]): Promise<void> {
  await vi.waitFor(() => expect(requests).toHaveLength(1));
}

function responseWithBody(body: unknown, status = 200, headers: Record<string, string> = {}): RelayFetchResponse {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function response(results: unknown[], status = 200, retryAfter?: string): RelayFetchResponse {
  return responseWithBody({ success: true, data: { results } }, status, retryAfter === undefined ? {} : { "retry-after": retryAfter });
}

async function rotateRelayAuthority(stateRepo: MemoryState): Promise<void> {
  await stateRepo.update((current) => ({
    ...current,
    grantId: "grant-new",
    generation: 8,
    credential: "credential-new",
    state: "ACTIVE",
    autoSyncEnabled: true,
    failureCount: 4,
    nextRetryAt: new Date(1_500_000).toISOString(),
  }));
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
      listPending: async () => [record("fresh"), record("stale-generation", 6), record("stale-grant", 7, "old-grant")],
      markImported: async (ids) => { imported.push([...ids]); },
      fetch: async (_input, init) => { requests.push(init); return response([{ clientRecordId: "fresh", outcome: "IMPORTED", ackEligible: true, errorCode: null }]); },
    });

    await runtime.drain();

    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0].body)).records).toHaveLength(1);
    expect(requests[0].headers).toMatchObject({ Authorization: "Bearer credential" });
    expect(requests[0].credentials).toBe("omit");
    expect(JSON.parse(String(requests[0].body)).records[0].solvedAt).toBe("1969-12-31T15:00:00.000Z");
    expect(JSON.parse(String(requests[0].body)).records[0]).toMatchObject({ executionTime: "78 ms", memoryUsage: "25,472 kb" });
    expect(imported).toEqual([["fresh"]]);
  });

  it("does not relay a no-performance SWEA capture during grace, then relays it at the durable bound", async () => {
    let now = 1_000_000;
    const eligibleAt = now + 5_000;
    const deferred = { ...record("deferred"), performance: undefined, relayEligibility: { eligibleAt: new Date(eligibleAt).toISOString() } };
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    const imported: string[][] = [];
    const runtime = new RelayRuntime({
      state: new MemoryState(state()),
      alarms,
      now: () => now,
      listPending: async () => now < eligibleAt ? [] : [deferred],
      nextEligibleAt: async () => now < eligibleAt ? eligibleAt : undefined,
      markImported: async (ids) => { imported.push([...ids]); },
      fetch: async (_input, init) => {
        requests.push(init);
        return response([{ clientRecordId: "deferred", outcome: "IMPORTED", ackEligible: true, errorCode: null }]);
      },
    });

    await runtime.onCaptureCommitted();
    expect(requests).toHaveLength(0);
    expect(alarms.created.at(-1)).toBe(eligibleAt);

    now = eligibleAt;
    await runtime.drain();

    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0].body)).records[0]).toMatchObject({ executionTime: null, memoryUsage: null });
    expect(imported).toEqual([["deferred"]]);
  });

  it("includes performance that arrives during grace in the first relay transfer", async () => {
    let now = 1_000_000;
    const eligibleAt = now + 5_000;
    let candidate: SolutionRecord = { ...record("enriched"), performance: undefined, relayEligibility: { eligibleAt: new Date(eligibleAt).toISOString() } };
    const requests: RequestInit[] = [];
    const runtime = new RelayRuntime({
      state: new MemoryState(state()),
      now: () => now,
      listPending: async () => now < eligibleAt && candidate.relayEligibility ? [] : [candidate],
      nextEligibleAt: async () => candidate.relayEligibility?.eligibleAt ? Date.parse(candidate.relayEligibility.eligibleAt) : undefined,
      markImported: async () => undefined,
      fetch: async (_input, init) => {
        requests.push(init);
        return response([{ clientRecordId: "enriched", outcome: "IMPORTED", ackEligible: true, errorCode: null }]);
      },
    });

    await runtime.onCaptureCommitted();
    candidate = { ...candidate, performance: { executionTime: "12 ms", memoryUsage: "3,072 kb" }, relayEligibility: undefined };
    now = eligibleAt - 100;
    await runtime.drain();

    expect(JSON.parse(String(requests[0]?.body)).records[0]).toMatchObject({ executionTime: "12 ms", memoryUsage: "3,072 kb" });
  });

  it("never selects a capture from another opaque grant when generations collide", async () => {
    const stateRepo = new MemoryState(state({ generation: 1, grantId: "grant-account-b" }));
    const requests: RequestInit[] = [];
    const runtime = new RelayRuntime({
      state: stateRepo,
      now: () => 1_000_000,
      listPending: async () => [record("account-a", 1, "grant-account-a"), record("account-b", 1, "grant-account-b")],
      markImported: async () => undefined,
      fetch: async (_input, init) => { requests.push(init); return response([{ clientRecordId: "account-b", outcome: "IMPORTED", ackEligible: true, errorCode: null }]); },
    });

    await runtime.drain();

    expect(JSON.parse(String(requests[0]?.body)).records.map((item: { clientRecordId: string }) => item.clientRecordId)).toEqual(["account-b"]);
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
    expect(stateRepo.value.lastFailure).toMatchObject({ category: "HTTP_401", status: 401 });
    expect(alarms.cleared).toContain(RELAY_DRAIN_ALARM);
  });

  it.each([
    ["401", responseWithBody({ requestId: "old-401" }, 401)],
    ["403", responseWithBody({ requestId: "old-403" }, 403)],
    ["malformed success", responseWithBody({ success: true, data: { results: [{ clientRecordId: "one" }] } })],
  ] as const)("does not let an old in-flight %s response invalidate a rotated grant", async (_label, deferredResponse) => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    let resolveResponse!: (value: RelayFetchResponse) => void;
    const pendingResponse = new Promise<RelayFetchResponse>((resolve) => { resolveResponse = resolve; });
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      fetch: async (_input, init) => { requests.push(init); return pendingResponse; },
    });

    const drain = runtime.drain();
    await waitForRequest(requests);
    await rotateRelayAuthority(stateRepo);
    resolveResponse(deferredResponse);
    await drain;

    expect(stateRepo.value).toMatchObject({ state: "ACTIVE", grantId: "grant-new", generation: 8, credential: "credential-new", failureCount: 4 });
    expect(stateRepo.value.lastFailure).toBeUndefined();
    expect(alarms.cleared).toHaveLength(0);
  });

  it("does not ACK records or reset bookkeeping when an old success arrives after rotation", async () => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const imported: string[][] = [];
    const requests: RequestInit[] = [];
    let resolveResponse!: (value: RelayFetchResponse) => void;
    const pendingResponse = new Promise<RelayFetchResponse>((resolve) => { resolveResponse = resolve; });
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      markImported: async (ids) => { imported.push([...ids]); },
      fetch: async (_input, init) => { requests.push(init); return pendingResponse; },
    });

    const drain = runtime.drain();
    await waitForRequest(requests);
    await rotateRelayAuthority(stateRepo);
    resolveResponse(response([{ clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null }]));
    await drain;

    expect(imported).toEqual([]);
    expect(stateRepo.value).toMatchObject({ state: "ACTIVE", grantId: "grant-new", generation: 8, credential: "credential-new", failureCount: 4 });
    expect(stateRepo.value.nextRetryAt).toBe(new Date(1_500_000).toISOString());
    expect(alarms.cleared).toHaveLength(0);
  });

  it.each([
    ["429 retry", response([], 429, "120")],
    ["503 retry", response([], 503)],
  ] as const)("does not schedule or increment retry state for an old %s response", async (_label, deferredResponse) => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    let resolveResponse!: (value: RelayFetchResponse) => void;
    const pendingResponse = new Promise<RelayFetchResponse>((resolve) => { resolveResponse = resolve; });
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      fetch: async (_input, init) => { requests.push(init); return pendingResponse; },
    });

    const drain = runtime.drain();
    await waitForRequest(requests);
    await rotateRelayAuthority(stateRepo);
    resolveResponse(deferredResponse);
    await drain;

    expect(stateRepo.value).toMatchObject({ state: "ACTIVE", grantId: "grant-new", generation: 8, credential: "credential-new", failureCount: 4 });
    expect(stateRepo.value.nextRetryAt).toBe(new Date(1_500_000).toISOString());
    expect(alarms.created).toHaveLength(0);
  });

  it("does not increment retry state when an old request fails after rotation", async () => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    let rejectRequest!: (error: unknown) => void;
    const pendingRequest = new Promise<RelayFetchResponse>((_resolve, reject) => { rejectRequest = reject; });
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      fetch: async (_input, init) => { requests.push(init); return pendingRequest; },
    });

    const drain = runtime.drain();
    await waitForRequest(requests);
    await rotateRelayAuthority(stateRepo);
    rejectRequest(new Error("network failure"));
    await drain;

    expect(stateRepo.value).toMatchObject({ state: "ACTIVE", grantId: "grant-new", generation: 8, credential: "credential-new", failureCount: 4 });
    expect(stateRepo.value.nextRetryAt).toBe(new Date(1_500_000).toISOString());
    expect(alarms.created).toHaveLength(0);
  });

  it("does not retry or overwrite explicit OFF while an old request is pending", async () => {
    const stateRepo = new MemoryState(state());
    const alarms = new MemoryAlarms();
    const requests: RequestInit[] = [];
    let resolveResponse!: (value: RelayFetchResponse) => void;
    const pendingResponse = new Promise<RelayFetchResponse>((resolve) => { resolveResponse = resolve; });
    const runtime = new RelayRuntime({
      state: stateRepo,
      alarms,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      fetch: async (_input, init) => { requests.push(init); return pendingResponse; },
    });

    const drain = runtime.drain();
    await waitForRequest(requests);
    await runtime.onAutomationState({ ...enabledState, autoSyncEnabled: false });
    resolveResponse(responseWithBody({ requestId: "old-after-stop" }, 401));
    await drain;

    expect(stateRepo.value.state).toBe("REVOCATION_PENDING");
    expect(stateRepo.value.credential).toBeUndefined();
    expect(stateRepo.value.lastFailure).toBeUndefined();
    expect(alarms.cleared).toContain(RELAY_DRAIN_ALARM);
  });

  it("records local expiry separately from server rejection", async () => {
    const stateRepo = new MemoryState(state({ expiresAt: new Date(999_999).toISOString() }));
    const runtime = new RelayRuntime({ state: stateRepo, now: () => 1_000_000, listPending: async () => [] });

    await runtime.drain();

    expect(stateRepo.value.state).toBe("EXPIRED");
    expect(stateRepo.value.lastFailure).toMatchObject({ category: "LOCAL_EXPIRED" });
    expect(stateRepo.value.lastFailure?.status).toBeUndefined();
  });

  it("does not expire a rotated grant when an old schedule snapshot is already expired", async () => {
    const oldState = state({ expiresAt: new Date(999_999).toISOString() });
    const stateRepo = new DeferredReadState(oldState);
    const alarms = new MemoryAlarms();
    const runtime = new RelayRuntime({ state: stateRepo, alarms, now: () => 1_000_000 });

    const schedule = (runtime as unknown as { scheduleIfEligible: () => Promise<void> }).scheduleIfEligible();
    await stateRepo.readStarted;
    stateRepo.releaseFirstReadWith(state({ grantId: "grant-new", generation: 8, credential: "credential-new" }));
    await schedule;

    expect(stateRepo.value).toMatchObject({ state: "ACTIVE", grantId: "grant-new", generation: 8, credential: "credential-new", autoSyncEnabled: true });
    expect(stateRepo.value.lastFailure).toBeUndefined();
    expect(alarms.cleared).toHaveLength(0);
    expect(alarms.created).toHaveLength(0);
  });

  it("reestablishes a new grant alarm when old invalidation cleanup follows its installation", async () => {
    const oldState = state();
    const oldAuthority = {
      revision: oldState.revision,
      deviceId: oldState.deviceId,
      grantId: oldState.grantId!,
      generation: oldState.generation!,
      credential: oldState.credential!,
    };
    const stateRepo = new MemoryState(state({ state: "EXPIRED", credential: undefined, autoSyncEnabled: false }));
    const alarms = new MemoryAlarms();
    const runtime = new RelayRuntime({ state: stateRepo, alarms, now: () => 1_000_000 });

    await stateRepo.update((current) => ({
      ...current,
      state: "ACTIVE",
      grantId: "grant-new",
      generation: 8,
      credential: "credential-new",
      autoSyncEnabled: true,
      expiresAt: new Date(2_000_000).toISOString(),
    }));
    await (runtime as unknown as { scheduleIfEligible: () => Promise<void> }).scheduleIfEligible();
    const createdBeforeOldCleanup = alarms.created.length;

    await (runtime as unknown as { cancelAlarm: (authority: typeof oldAuthority) => Promise<void> }).cancelAlarm(oldAuthority);

    expect(createdBeforeOldCleanup).toBe(1);
    expect(alarms.cleared).toEqual([RELAY_DRAIN_ALARM]);
    expect(alarms.created.length).toBeGreaterThan(createdBeforeOldCleanup);
    expect(stateRepo.value).toMatchObject({ state: "ACTIVE", grantId: "grant-new", generation: 8, credential: "credential-new", autoSyncEnabled: true });
  });

  it.each([
    ["HTTP_403", 403, "INVALIDATED", { requestId: "req-403", error: { code: "RELAY_GRANT_REVOKED", detail: "do-not-persist" } }],
    ["HTTP_OTHER", 404, "INVALIDATED", { requestId: "req-404", errorCode: "RELAY_NOT_FOUND", source: "do-not-persist" }],
  ] as const)("records %s without retaining the response body", async (category, status, expectedState, body) => {
    const stateRepo = new MemoryState(state());
    const runtime = new RelayRuntime({
      state: stateRepo,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      fetch: async () => responseWithBody(body, status, { "x-request-id": `header-${status}` }),
    });

    await runtime.drain();

    expect(stateRepo.value.state).toBe(expectedState);
    expect(stateRepo.value.credential).toBeUndefined();
    expect(stateRepo.value.lastFailure).toMatchObject({ category, status, requestId: `header-${status}` });
    expect(stateRepo.value.lastFailure?.errorCode).toBe(category === "HTTP_403" ? "RELAY_GRANT_REVOKED" : "RELAY_NOT_FOUND");
    expect(JSON.stringify(stateRepo.value)).not.toContain("do-not-persist");
  });

  it("records malformed success envelopes separately and redacts arbitrary fields", async () => {
    const stateRepo = new MemoryState(state());
    const runtime = new RelayRuntime({
      state: stateRepo,
      now: () => 1_000_000,
      listPending: async () => [record("one")],
      fetch: async () => responseWithBody({
        success: true,
        requestId: "req-malformed",
        error: { code: "INVALID_RESULT", body: "source-code-secret" },
        data: { results: [{ clientRecordId: "one", outcome: "IMPORTED", ackEligible: "not-a-boolean" }] },
      }),
    });

    await runtime.drain();

    expect(stateRepo.value.state).toBe("INVALIDATED");
    expect(stateRepo.value.lastFailure).toMatchObject({ category: "MALFORMED_RESPONSE", status: 200, requestId: "req-malformed", errorCode: "INVALID_RESULT" });
    expect(JSON.stringify(stateRepo.value)).not.toContain("source-code-secret");
    expect(JSON.stringify(stateRepo.value)).not.toContain("credential");
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
    const previousIndexedDb = (globalThis as any).indexedDB;
    const previousChrome = (globalThis as any).chrome;
    const relayNow = Date.now();
    const indexedDb = new MemoryIndexedDbFactory();
    (globalThis as any).indexedDB = indexedDb;
    (globalThis as any).chrome = {
      runtime: {
        onMessage: { addListener: () => undefined },
        onConnectExternal: { addListener: () => undefined },
      },
    };
    try {
      await openCodeArchiveDatabase();
      const relayState = state({ expiresAt: new Date(relayNow + 60 * 60 * 1000).toISOString() });
      await indexedDb.seedRelayState({
        revision: 0,
        deviceId: relayState.deviceId,
        state: relayState.state,
        grantId: "grant-account-a",
        credential: relayState.credential,
        generation: relayState.generation,
        expiresAt: relayState.expiresAt,
        autoSyncEnabled: true,
      });
      await saveAcceptedCapture({
        captureId: "before-account-switch",
        platform: "SWEA",
        result: "ACCEPTED",
        problemNumber: "1234",
        title: "title",
        language: "Java",
        code: "class AccountA {}",
        observedAt: "1970-01-01T00:00:01.000Z",
        solvedAt: "1970-01-01",
      });
      await expect(listRelayPendingCaptures("grant-account-a", 7, 25, relayNow + 4_000)).resolves.toEqual([]);
      await expect(listRelayPendingCaptures("grant-account-a", 7, 25, relayNow + 6_000)).resolves.toHaveLength(1);
      await indexedDb.seedRelayState({
        revision: 1,
        deviceId: relayState.deviceId,
        state: relayState.state,
        grantId: relayState.grantId,
        credential: relayState.credential,
        generation: relayState.generation,
        expiresAt: relayState.expiresAt,
        autoSyncEnabled: true,
      });
      const { saveThenSyncAcceptedCapture } = await import("../background");
      const stateRepo = new MemoryState(relayState);
      const alarms = new MemoryAlarms();
      const requests: RequestInit[] = [];
      const runtime = new RelayRuntime({
        state: stateRepo,
        alarms,
        now: () => relayNow,
        listPending: (grantId, generation) => listRelayPendingCaptures(grantId, generation),
        fetch: async (_input, init) => {
          requests.push(init);
          const body = JSON.parse(String(init.body)) as { records: Array<{ clientRecordId: string }> };
          return response(body.records.map((item) => ({ clientRecordId: item.clientRecordId, outcome: "IMPORTED", ackEligible: true, errorCode: null })));
        },
      });
      const bridge = new ExtensionDashboardCaptureBridge(new EmptyCaptureBridgeRepository(), () => relayNow, () => "cap", undefined, runtime);
      const port = new DisconnectPort();
      expect(bridge.connect(port, "https://dashboard.example.com")).toBe(true);
      port.disconnect();
      const disconnectedProjection = bridge.getAutomationState();
      expect(disconnectedProjection).toMatchObject({ connectionAvailable: false, errorCode: "DASHBOARD_DISCONNECTED" });
      await runtime.onAutomationState(disconnectedProjection);

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
        performance: { executionTime: "1 ms", memoryUsage: "2 kb" },
      };
      const result = await saveThenSyncAcceptedCapture(capture, {
        saveCapture: saveAcceptedCapture,
        onCaptureCommitted: () => runtime.onCaptureCommitted(),
      });

      expect(result).toMatchObject({ status: "saved", solutionId: "swea-auto:after-disconnect" });
      expect(stateRepo.value.state).toBe("ACTIVE");
      expect(stateRepo.value.credential).toBe("credential");
      await vi.waitFor(() => expect(alarms.created.at(-1)).toBe(relayNow));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await waitForRequest(requests);
      const sent = JSON.parse(String(requests[0]?.body)) as { records: Array<{ clientRecordId: string; capturedAt: string }> };
      expect(sent.records).toHaveLength(1);
      expect(sent.records[0]?.clientRecordId).toBeTruthy();
      expect(sent.records[0]?.capturedAt).toBeTruthy();

      const persisted = await indexedDbSolutionRepository.getById("swea-auto:after-disconnect");
      expect(persisted?.relayCapture).toMatchObject({ grantId: "grant-1234", generation: 7 });
      expect(persisted?.relayImportReceipt).toEqual(expect.objectContaining({ importedAt: expect.any(String) }));
      const retainedFromPreviousAccount = await indexedDbSolutionRepository.getById("swea-auto:before-account-switch");
      expect(retainedFromPreviousAccount?.relayCapture).toMatchObject({ grantId: "grant-account-a", generation: 7 });
      expect(retainedFromPreviousAccount?.relayImportReceipt).toBeUndefined();
      await expect(listRelayPendingCaptures("grant-1234", 7)).resolves.toEqual([]);
    } finally {
      (globalThis as any).indexedDB = previousIndexedDb;
      (globalThis as any).chrome = previousChrome;
    }
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
    ["future captured timestamp", { relayCapture: { grantId: "grant-1234", generation: 7, capturedAt: new Date(1_400_001).toISOString() } }],
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
