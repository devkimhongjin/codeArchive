import { describe, expect, it, vi } from "vitest";
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

async function connectBridge() {
  const port = new FakePort();
  const states: ExtensionConnectionState[] = [];
  const connection = createDashboardExtensionConnection({ connect: () => port });
  connection.start((state) => states.push(state));
  port.receive({ ok: true, data: { protocolVersion: 1 } });
  await flush();
  port.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 } });
  await flush();
  return { port, states, connection };
}

describe("Dashboard Extension connection", () => {
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

    expect(JSON.stringify(port.sent)).not.toMatch(/IMPORT_BEGIN|CAPTURE_PAGE|CAPTURE_ACK|clientRecordId|records/i);
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
