import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  type CodeArchiveBridgeFailure,
  type CodeArchiveCaptureSummaryData,
  type CodeArchiveCaptureSummaryResponse,
  type CodeArchivePingResponse,
} from "../../../packages/shared-types/src";
import { CODEARCHIVE_EXTENSION_ID } from "./extensionConfig";

const BRIDGE_RESPONSE_TIMEOUT_MS = 5_000;

interface RuntimePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

interface ChromeRuntime {
  lastError?: { message?: string };
  connect(extensionId: string, connectInfo: { name: string }): RuntimePort;
}

export type ExtensionConnectionState =
  | { readonly status: "unavailable" }
  | { readonly status: "connecting" }
  | { readonly status: "connected"; readonly summary: CodeArchiveCaptureSummaryData }
  | { readonly status: "error" };

export interface DashboardExtensionConnection {
  start(onState: (state: ExtensionConnectionState) => void): () => void;
}

function safeFailure(value: unknown): value is CodeArchiveBridgeFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; error?: { code?: unknown } };
  return candidate.ok === false && typeof candidate.error?.code === "string";
}

function runtimeFromPage(): ChromeRuntime | null {
  const candidate = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  return candidate && typeof candidate.connect === "function" ? candidate : null;
}

export function createDashboardExtensionConnection(
  runtime: ChromeRuntime | null = runtimeFromPage(),
  extensionId = CODEARCHIVE_EXTENSION_ID,
): DashboardExtensionConnection {
  return {
    start(onState) {
      if (!runtime) {
        onState({ status: "unavailable" });
        return () => undefined;
      }

      onState({ status: "connecting" });
      let active = true;
      let port: RuntimePort;
      const pending: Array<(message: unknown) => void> = [];

      try {
        port = runtime.connect(extensionId, { name: "codearchive-dashboard" });
      } catch {
        onState({ status: "error" });
        return () => undefined;
      }

      port.onMessage.addListener((message) => {
        pending.shift()?.(message);
      });
      port.onDisconnect.addListener(() => {
        if (!active) return;
        active = false;
        pending.splice(0).forEach((resolve) => resolve(null));
        onState({ status: runtime.lastError ? "error" : "unavailable" });
      });

      const request = <T>(message: unknown) => new Promise<T | null>((resolve) => {
        const complete = (response: unknown) => {
          globalThis.clearTimeout(timeout);
          resolve(response as T | null);
        };
        const timeout = globalThis.setTimeout(() => {
          const index = pending.indexOf(complete);
          if (index >= 0) pending.splice(index, 1);
          resolve(null);
        }, BRIDGE_RESPONSE_TIMEOUT_MS);
        pending.push(complete);
        try {
          port.postMessage(message);
        } catch {
          const index = pending.indexOf(complete);
          if (index >= 0) pending.splice(index, 1);
          complete(null);
        }
      });

      void (async () => {
        const ping = await request<CodeArchivePingResponse>({
          type: "CODEARCHIVE_PING",
          protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        });
        if (!active || !ping || safeFailure(ping) || !ping.ok) {
          if (active) onState({ status: "error" });
          return;
        }

        const summary = await request<CodeArchiveCaptureSummaryResponse>({
          type: "CODEARCHIVE_CAPTURE_SUMMARY",
          protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
        });
        if (!active || !summary || safeFailure(summary) || !summary.ok) {
          if (active) onState({ status: "error" });
          return;
        }
        onState({ status: "connected", summary: summary.data });
      })();

      return () => {
        if (!active) return;
        active = false;
        pending.splice(0).forEach((resolve) => resolve(null));
        port.disconnect();
      };
    },
  };
}

export const dashboardExtensionConnection = createDashboardExtensionConnection();
