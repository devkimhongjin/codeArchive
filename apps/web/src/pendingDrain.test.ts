import { describe, expect, it, vi } from "vitest";
import type { CaptureImportRecord } from "../../../packages/shared-types/src";
import type { DashboardExtensionConnection } from "./extensionConnection";
import {
  createPendingDrainApiClient,
  createPendingDrainController,
  parsePendingPage,
  type PendingDrainApiClient,
} from "./pendingDrain";

const record = (clientRecordId: string): CaptureImportRecord => ({
  clientRecordId,
  problem: {
    platform: "SWEA",
    platformProblemId: `swea-${clientRecordId}`,
    problemNumber: "1234",
    title: "중위순회",
    url: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=test",
    tags: [],
  },
  language: "JAVA",
  code: "class Solution {}",
  result: "ACCEPTED",
  submittedAt: "2026-08-28T00:00:00.000Z",
});

const page = (records: readonly CaptureImportRecord[], nextCursor?: string) => ({
  ok: true,
  data: {
    protocolVersion: 1,
    scope: "pending",
    records,
    revision: 3,
    ...(nextCursor ? { nextCursor } : {}),
  },
});

const apiEnvelope = (results: readonly unknown[], requestId = "req-test") => ({
  success: true,
  data: { results },
  error: null,
  requestId,
});

function bridge(overrides: Partial<DashboardExtensionConnection> = {}): DashboardExtensionConnection {
  return {
    start: () => () => undefined,
    startSyncSession: async () => true,
    endSyncSession: async () => undefined,
    beginImport: vi.fn(async () => "capability-a"),
    readPendingPage: vi.fn(async () => page([record("one")])),
    ackImported: vi.fn(async () => true),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("pending page validation", () => {
  it("fails closed on malformed or source-invalid bridge pages", () => {
    expect(parsePendingPage(page([record("one")]))?.records).toHaveLength(1);
    expect(parsePendingPage({ ok: true, data: { protocolVersion: 1, scope: "all", records: [], revision: 1 } })).toBeNull();
    expect(parsePendingPage(page([{ ...record("one"), language: "SECRET" } as never]))).toBeNull();
    expect(parsePendingPage(page([record("one"), record("one")]))).toBeNull();
  });
});

describe("Main API pending upsert client", () => {
  it("posts exact bulk-upsert request with credentials and no ownership field", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(apiEnvelope([
      { clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null },
    ], "req-1")), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createPendingDrainApiClient(fetcher);
    expect(await client.upsert("batch-a", [record("one")])).toEqual(["one"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://codearchive-api.onrender.com/api/v1/solutions/bulk-upsert");
    expect(init).toMatchObject({ method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(String(init?.body));
    expect(body.importBatchId).toBe("batch-a");
    expect(body.records[0].clientRecordId).toBe("one");
    expect(JSON.stringify(body)).not.toMatch(/userId|accountId|owner/i);
  });

  it("accepts unique valid results and ACK-selects only offered IMPORTED/EXISTING IDs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(apiEnvelope([
      { clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null },
      { clientRecordId: "two", outcome: "EXISTING", ackEligible: true, errorCode: null },
      { clientRecordId: "three", outcome: "FAILED", ackEligible: false, errorCode: "PERSISTENCE_FAILED" },
      { clientRecordId: "not-offered", outcome: "IMPORTED", ackEligible: true, errorCode: null },
    ], "req-2")), { status: 200 }));
    const client = createPendingDrainApiClient(fetcher);
    expect(await client.upsert("batch-a", [record("one"), record("two"), record("three")])).toEqual(["one", "two"]);
  });

  it("fails closed on duplicate IMPORTED result IDs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(apiEnvelope([
      { clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null },
      { clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null },
    ])), { status: 200 }));
    expect(await createPendingDrainApiClient(fetcher).upsert("batch-a", [record("one")])).toBeNull();
  });

  it("fails closed on duplicate IDs with IMPORTED plus FAILED", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(apiEnvelope([
      { clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null },
      { clientRecordId: "one", outcome: "FAILED", ackEligible: false, errorCode: "INVALID_RECORD" },
    ])), { status: 200 }));
    expect(await createPendingDrainApiClient(fetcher).upsert("batch-a", [record("one")])).toBeNull();
  });

  it("fails closed when a malformed sibling appears beside a valid result", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(apiEnvelope([
      { clientRecordId: "one", outcome: "IMPORTED", ackEligible: true, errorCode: null },
      { clientRecordId: "two", outcome: "FAILED", ackEligible: true, errorCode: "INVALID_RECORD" },
    ])), { status: 200 }));
    expect(await createPendingDrainApiClient(fetcher).upsert("batch-a", [record("one"), record("two")])).toBeNull();
  });

  it("never returns an ACKable ID that was not offered by the current page", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(apiEnvelope([
      { clientRecordId: "not-offered", outcome: "EXISTING", ackEligible: true, errorCode: null },
    ])), { status: 200 }));
    expect(await createPendingDrainApiClient(fetcher).upsert("batch-a", [record("one")])).toEqual([]);
  });

  it("returns no ACK evidence for network, non-success, or malformed envelopes", async () => {
    expect(await createPendingDrainApiClient(async () => { throw new Error("offline"); }).upsert("b", [record("one")])).toBeNull();
    expect(await createPendingDrainApiClient(async () => new Response("x", { status: 503 })).upsert("b", [record("one")])).toBeNull();
    expect(await createPendingDrainApiClient(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })).upsert("b", [record("one")])).toBeNull();
  });
});

describe("automatic pending drain", () => {
  it("eligible scheduling begins import, reads pending page, and partially ACKs with retained batch id", async () => {
    const ackImported = vi.fn(async () => true);
    const connection = bridge({ ackImported });
    const api: PendingDrainApiClient = { upsert: vi.fn(async () => ["one"]) };
    const controller = createPendingDrainController(connection, api, () => "batch-a", () => true);
    controller.schedule("session-a");
    await flush();
    expect(connection.beginImport).toHaveBeenCalledWith("session-a");
    expect(connection.readPendingPage).toHaveBeenCalledWith("capability-a", undefined);
    expect(api.upsert).toHaveBeenCalledWith("batch-a", [record("one")]);
    expect(ackImported).toHaveBeenCalledWith("capability-a", "batch-a", ["one"]);
  });

  it("ineligible state never requests source", async () => {
    const connection = bridge();
    const controller = createPendingDrainController(connection, { upsert: vi.fn() }, () => "batch-a", () => false);
    controller.schedule("session-a");
    await flush();
    expect(connection.beginImport).not.toHaveBeenCalled();
    expect(connection.readPendingPage).not.toHaveBeenCalled();
  });

  it("malformed page or API failure produces no ACK", async () => {
    const ackImported = vi.fn(async () => true);
    const malformed = bridge({ readPendingPage: vi.fn(async () => ({ ok: true, data: { protocolVersion: 1, scope: "pending", records: [{ secret: true }], revision: 1 } })), ackImported });
    createPendingDrainController(malformed, { upsert: vi.fn(async () => ["one"]) }, () => "batch-a", () => true).schedule("session-a");
    await flush();
    expect(ackImported).not.toHaveBeenCalled();

    const apiFailedAck = vi.fn(async () => true);
    const apiFailed = bridge({ ackImported: apiFailedAck });
    createPendingDrainController(apiFailed, { upsert: vi.fn(async () => null) }, () => "batch-a", () => true).schedule("session-a");
    await flush();
    expect(apiFailedAck).not.toHaveBeenCalled();
  });

  it("drains nextCursor pages with one capability", async () => {
    const readPendingPage = vi.fn()
      .mockResolvedValueOnce(page([record("one")], "cursor-2"))
      .mockResolvedValueOnce(page([record("two")]));
    const ackImported = vi.fn(async () => true);
    const api: PendingDrainApiClient = {
      upsert: vi.fn(async (_batch: string, records: readonly CaptureImportRecord[]) =>
        records.map((item: CaptureImportRecord) => item.clientRecordId)),
    };
    const ids = ["batch-1", "batch-2"];
    const connection = bridge({ readPendingPage, ackImported });
    createPendingDrainController(connection, api, () => ids.shift()!, () => true).schedule("session-a");
    await flush();
    expect(readPendingPage.mock.calls).toEqual([["capability-a", undefined], ["capability-a", "cursor-2"]]);
    expect(ackImported.mock.calls).toEqual([
      ["capability-a", "batch-1", ["one"]],
      ["capability-a", "batch-2", ["two"]],
    ]);
  });

  it("serializes drains and schedules one catch-up after an in-flight trigger", async () => {
    let release!: () => void;
    let concurrent = 0;
    let maxConcurrent = 0;
    const beginImport = vi.fn(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => { release = resolve; });
      concurrent -= 1;
      return "capability-a";
    });
    const connection = bridge({ beginImport, readPendingPage: vi.fn(async () => page([])) });
    const controller = createPendingDrainController(connection, { upsert: vi.fn() }, () => "batch", () => true);
    controller.schedule("session-a");
    await Promise.resolve();
    controller.schedule("session-a");
    expect(controller.isRunning()).toBe(true);
    release();
    await flush();
    expect(maxConcurrent).toBe(1);
    expect(beginImport).toHaveBeenCalledTimes(2);
  });

  it("eligibility invalidation during API work prevents ACK/further source work", async () => {
    let eligible = true;
    let finishApi!: (ids: readonly string[] | null) => void;
    const ackImported = vi.fn(async () => true);
    const api: PendingDrainApiClient = {
      upsert: vi.fn((_batch: string, _records: readonly CaptureImportRecord[]) =>
        new Promise<readonly string[] | null>((resolve) => { finishApi = resolve; })),
    };
    const connection = bridge({ ackImported });
    const controller = createPendingDrainController(connection, api, () => "batch-a", () => eligible);
    controller.schedule("session-a");
    await Promise.resolve();
    await Promise.resolve();
    eligible = false;
    controller.invalidate();
    finishApi(["one"]);
    await flush();
    expect(ackImported).not.toHaveBeenCalled();
  });
});
