import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CODEARCHIVE_EXTENSION_ID } from "./extensionConfig";
import { createDashboardExtensionConnection, type ExtensionConnectionState } from "./extensionConnection";

class FakePort {
  readonly sent: unknown[] = [];
  readonly messageListeners: Array<(message: unknown) => void> = [];
  readonly disconnectListeners: Array<() => void> = [];
  disconnected = false;
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => this.messageListeners.push(listener) };
  readonly onDisconnect = { addListener: (listener: () => void) => this.disconnectListeners.push(listener) };
  postMessage(message: unknown) { this.sent.push(message); }
  disconnect() {
    this.disconnected = true;
    this.disconnectListeners.forEach((listener) => listener());
  }
  receive(message: unknown) { this.messageListeners.forEach((listener) => listener(message)); }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function connectBridge(onCaptureChanged?: (event: never) => void) {
  const port = new FakePort();
  const states: ExtensionConnectionState[] = [];
  const connection = createDashboardExtensionConnection({ connect: () => port });
  connection.start((state) => states.push(state), onCaptureChanged as never);
  port.receive({ ok: true, data: { protocolVersion: 1 } });
  await flush();
  port.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 } });
  await flush();
  return { port, states, connection };
}

describe("Dashboard Extension connection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("reconnects with metadata only, ignores old port events and cancels on disposal", async () => {
    const ports: FakePort[] = [];
    const connect = vi.fn(() => { const port = new FakePort(); ports.push(port); return port; });
    const changed = vi.fn();
    const states: ExtensionConnectionState[] = [];
    const connection = createDashboardExtensionConnection({ connect });
    const stop = connection.start((state) => states.push(state), changed);
    ports[0]!.receive({ ok: true, data: { protocolVersion: 1 } });
    await flush();
    ports[0]!.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 } });
    await flush();
    const pending = connection.startSyncSession("old-session");
    ports[0]!.disconnect();
    expect(await pending).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    ports[0]!.receive({ type: "CODEARCHIVE_CAPTURE_CHANGED", protocolVersion: 1, pendingCount: 99, revision: 99 });
    ports[1]!.receive({ ok: true, data: { protocolVersion: 1 } });
    await flush();
    ports[1]!.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 } });
    await flush();
    expect(states.at(-1)?.status).toBe("connected");
    expect(changed).not.toHaveBeenCalled();
    expect(JSON.stringify(ports[1]!.sent)).not.toMatch(/SESSION_START|IMPORT_BEGIN|CAPTURE_PAGE/);
    ports[1]!.disconnect();
    stop();
    await vi.runAllTimersAsync();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exhausts three retries without infinite timers and permits manual restart", async () => {
    const connect = vi.fn(() => { throw new Error("unavailable"); });
    const connection = createDashboardExtensionConnection({ connect });
    const state = vi.fn();
    connection.start(state);
    await vi.runAllTimersAsync();
    expect(connect).toHaveBeenCalledTimes(4);
    expect(state).toHaveBeenLastCalledWith({ status: "error" });
    expect(vi.getTimerCount()).toBe(0);
    const stop = connection.start(state);
    expect(connect).toHaveBeenCalledTimes(5);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the exact beta Extension ID and requests metadata only before consent eligibility", async () => {
    const port = new FakePort();
    const connect = vi.fn(() => port);
    const states: ExtensionConnectionState[] = [];
    const stop = createDashboardExtensionConnection({ connect }).start((state) => states.push(state));

    expect(connect).toHaveBeenCalledWith(CODEARCHIVE_EXTENSION_ID, { name: "codearchive-dashboard" });
    expect(port.sent).toEqual([{ type: "CODEARCHIVE_PING", protocolVersion: 1 }]);
    port.receive({ ok: true, data: { protocolVersion: 1 } });
    await flush();
    expect(port.sent).toEqual([
      { type: "CODEARCHIVE_PING", protocolVersion: 1 },
      { type: "CODEARCHIVE_CAPTURE_SUMMARY", protocolVersion: 1 },
    ]);
    port.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 } });
    await flush();

    expect(states.at(-1)).toEqual({ status: "connected", summary: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 } });
    expect(JSON.stringify(port.sent)).not.toMatch(/SESSION_START|IMPORT_BEGIN|CAPTURE_PAGE|CAPTURE_ACK|capability|clientRecordId|records/i);
    stop();
  });

  it("emits only safe START/END lifecycle payloads for an eligible session", async () => {
    const { port, connection } = await connectBridge();
    const started = connection.startSyncSession("secure-session-id");
    expect(port.sent.at(-1)).toEqual({
      type: "CODEARCHIVE_SYNC_SESSION_START",
      protocolVersion: 1,
      syncSessionId: "secure-session-id",
      authenticated: true,
      autoSyncConsent: true,
    });
    expect(JSON.stringify(port.sent.at(-1))).not.toMatch(/user|account|email|token|cookie|oauth/i);
    port.receive({ ok: true, data: { protocolVersion: 1, syncSessionId: "secure-session-id" } });
    await expect(started).resolves.toBe(true);

    const ended = connection.endSyncSession("secure-session-id");
    expect(port.sent.at(-1)).toEqual({
      type: "CODEARCHIVE_SYNC_SESSION_END",
      protocolVersion: 1,
      syncSessionId: "secure-session-id",
    });
    port.receive({ ok: true, data: { protocolVersion: 1, syncSessionId: "secure-session-id" } });
    await ended;
  });

  it("uses IMPORT_BEGIN capability for pending PAGE <=25 and ACK with retained batch id", async () => {
    const { port, connection } = await connectBridge();

    const begin = connection.beginImport!("session-a");
    expect(port.sent.at(-1)).toEqual({ type: "CODEARCHIVE_IMPORT_BEGIN", protocolVersion: 1, syncSessionId: "session-a" });
    port.receive({ ok: true, data: { protocolVersion: 1, capability: "cap-a" } });
    await expect(begin).resolves.toBe("cap-a");

    const pendingPage = connection.readPendingPage!("cap-a", "cursor-a");
    expect(port.sent.at(-1)).toEqual({
      type: "CODEARCHIVE_CAPTURE_PAGE",
      protocolVersion: 1,
      capability: "cap-a",
      cursor: "cursor-a",
      limit: 25,
      scope: "pending",
    });
    const pageResponse = { ok: true, data: { protocolVersion: 1, scope: "pending", records: [], revision: 9 } };
    port.receive(pageResponse);
    await expect(pendingPage).resolves.toEqual(pageResponse);

    const ack = connection.ackImported!("cap-a", "batch-a", ["record-a"]);
    expect(port.sent.at(-1)).toEqual({
      type: "CODEARCHIVE_CAPTURE_ACK",
      protocolVersion: 1,
      capability: "cap-a",
      importBatchId: "batch-a",
      clientRecordIds: ["record-a"],
    });
    port.receive({ ok: true, data: { protocolVersion: 1, importBatchId: "batch-a", acknowledgedAt: "2026-08-28T00:00:00Z", acknowledgedClientRecordIds: ["record-a"] } });
    await expect(ack).resolves.toBe(true);
  });

  it("delivers metadata CAPTURE_CHANGED without consuming an in-flight request response", async () => {
    const changed = vi.fn();
    const { port, connection } = await connectBridge(changed as never);
    const begin = connection.beginImport!("session-a");
    port.receive({ type: "CODEARCHIVE_CAPTURE_CHANGED", protocolVersion: 1, pendingCount: 4, revision: 10 });
    expect(changed).toHaveBeenCalledWith({ type: "CODEARCHIVE_CAPTURE_CHANGED", protocolVersion: 1, pendingCount: 4, revision: 10 });
    port.receive({ ok: true, data: { protocolVersion: 1, capability: "cap-a" } });
    await expect(begin).resolves.toBe("cap-a");
  });

  it("routes automation control messages separately and publishes only sanitized state", async () => {
    const port = new FakePort();
    const controls: unknown[] = [];
    const connection = createDashboardExtensionConnection({ connect: () => port });
    connection.start(() => undefined, undefined, (message) => controls.push(message));
    port.receive({ ok: true, data: { protocolVersion: 1 } });
    await flush();
    port.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 0, allCount: 0, revision: 1 } });
    await flush();
    port.receive({ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: 1 });
    expect(controls).toEqual([{ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: 1 }]);
    expect(connection.publishAutomationState!({ protocolVersion: 1, autoSyncEnabled: true, githubAutoCommitEnabled: false, githubTargetConfigured: true, authenticated: true, connectionAvailable: true, errorCode: null })).toBe(true);
    expect(port.sent.at(-1)).toEqual({ type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE", protocolVersion: 1, state: { protocolVersion: 1, autoSyncEnabled: true, githubAutoCommitEnabled: false, githubTargetConfigured: true, authenticated: true, connectionAvailable: true, errorCode: null } });
  });

  it("fails closed on malformed IMPORT_BEGIN and ACK responses", async () => {
    const { port, connection } = await connectBridge();
    const begin = connection.beginImport!("session-a");
    port.receive({ ok: true, data: { protocolVersion: 1, capability: "" } });
    await expect(begin).resolves.toBeNull();

    const ack = connection.ackImported!("cap-a", "batch-a", ["record-a"]);
    port.receive({ ok: true, data: { protocolVersion: 1, importBatchId: "other", acknowledgedAt: "now", acknowledgedClientRecordIds: ["record-a"] } });
    await expect(ack).resolves.toBe(false);
  });

  it("ignores metadata change events while awaiting a lifecycle response", async () => {
    const { port, connection } = await connectBridge();
    const started = connection.startSyncSession("secure-session-id");
    port.receive({ type: "CODEARCHIVE_CAPTURE_CHANGED", protocolVersion: 1, pendingCount: 3, revision: 9 });
    port.receive({ ok: true, data: { protocolVersion: 1, syncSessionId: "secure-session-id" } });
    await expect(started).resolves.toBe(true);
  });

  it("reports unavailable without the Chrome external runtime", () => {
    const states: ExtensionConnectionState[] = [];
    const connection = createDashboardExtensionConnection(null);
    connection.start((state) => states.push(state));
    expect(states).toEqual([{ status: "unavailable" }]);
  });

  it("reports a safe error when protocol negotiation fails", async () => {
    const port = new FakePort();
    const states: ExtensionConnectionState[] = [];
    createDashboardExtensionConnection({ connect: () => port }).start((state) => states.push(state));
    port.receive({ ok: false, error: { code: "UNSUPPORTED_PROTOCOL", retryable: false } });
    await flush();
    expect(states.at(-1)).toEqual({ status: "error" });
    expect(port.disconnected).toBe(true);
  });

  it("rejects malformed success responses and closes the Port", async () => {
    const port = new FakePort();
    const states: ExtensionConnectionState[] = [];
    createDashboardExtensionConnection({ connect: () => port }).start((state) => states.push(state));
    port.receive({ ok: true, data: { protocolVersion: 1 } });
    await flush();
    port.receive({ ok: true, data: { protocolVersion: 1, pendingCount: "secret", allCount: 5 } });
    await flush();
    expect(states.at(-1)).toEqual({ status: "error" });
    expect(port.disconnected).toBe(true);
  });

  it("times out an unresponsive bridge and closes the Port", async () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const states: ExtensionConnectionState[] = [];
    createDashboardExtensionConnection({ connect: () => port }).start((state) => states.push(state));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(states.at(-1)).toEqual({ status: "error" });
    expect(port.disconnected).toBe(true);
    vi.useRealTimers();
  });
});
