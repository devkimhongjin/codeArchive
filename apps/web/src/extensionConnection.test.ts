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

describe("Dashboard Extension connection", () => {
  it("uses the exact beta Extension ID and requests metadata only", async () => {
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

    expect(states.at(-1)).toEqual({
      status: "connected",
      summary: { protocolVersion: 1, pendingCount: 2, allCount: 5, revision: 8 },
    });
    expect(JSON.stringify(port.sent)).not.toMatch(/SESSION_START|IMPORT_BEGIN|CAPTURE_PAGE|CAPTURE_ACK|capability|clientRecordId|records/i);
    stop();
  });

  it("reports unavailable without the Chrome external runtime", () => {
    const states: ExtensionConnectionState[] = [];
    createDashboardExtensionConnection(null).start((state) => states.push(state));
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
