import type { Capture, CaptureSettings } from "./types";
import type { CaptureStore } from "./storage";
import { LEGACY_DASHBOARD_ORIGIN, LEGACY_RELAY_ORIGINS, PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';

export type RelayAttemptResult = "ACK" | "OFFLINE" | "AUTH_EXPIRED" | "RELAY_ERROR" | "DISABLED";
export type GithubCommitStatus = "NOT_REQUESTED" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
export const RELAY_REQUEST_TIMEOUT_MS = 8_000;

function trustedRelayEndpoint(value: string): URL | null {
  try {
    const endpoint = new URL(value, PUBLIC_API_ORIGIN);
    if (endpoint.username || endpoint.password || !endpoint.pathname.startsWith('/api/relay/')) return null;
    return endpoint.origin === PUBLIC_API_ORIGIN || (LEGACY_RELAY_ORIGINS as readonly string[]).includes(endpoint.origin) ? endpoint : null;
  } catch { return null; }
}

/** Moves an existing opaque grant to the direct host only for the exact persisted
 * account/version snapshot. The grant's scope and secret are unchanged. */
export async function migrateLegacyRelayEndpoint(store: Pick<CaptureStore, 'mutateRelayIfCurrent'>, settings: CaptureSettings): Promise<boolean> {
  const relay = settings.relay, endpoint = relay && trustedRelayEndpoint(relay.endpoint);
  // localhost grants can belong to a developer's unrelated local API. Only
  // the old published dashboard proxy is known to address the same service.
  if (!relay || !endpoint || endpoint.origin !== LEGACY_DASHBOARD_ORIGIN) return false;
  let migrated = false;
  await store.mutateRelayIfCurrent(relay, current => {
    if (current.accountId !== relay.accountId || current.accountSettingsVersion !== relay.generation) return current;
    migrated = true;
    return { ...current, relay: { ...relay, endpoint: new URL(endpoint.pathname + endpoint.search, PUBLIC_API_ORIGIN).href } };
  });
  return migrated;
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Relay request timed out", "TimeoutError"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timeoutFailure
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** The extension owns no GitHub credential; only this narrow capture relay grant crosses the wire. */
export async function relayCapture(
  capture: Capture,
  settings: CaptureSettings,
  fetcher: typeof fetch = fetch,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS
): Promise<RelayAttemptResult> {
  const relay = settings.relay;
  if (!settings.autoSyncEnabled || !relay || relay.status === "AUTH_EXPIRED") return "DISABLED";
  if (relay.status !== "CONFIRMED" && relay.status !== "OFFLINE" && relay.status !== "RELAY_ERROR") return "DISABLED";
  const endpoint = trustedRelayEndpoint(relay.endpoint); if (!endpoint) return "RELAY_ERROR";
  try {
    const { syncAccountId: _deviceOwner, ...payload } = capture;
    const response = await fetchWithTimeout(fetcher, endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${relay.secret}` }, body: JSON.stringify(payload) }, timeoutMs);
    if (response.status === 401) return "AUTH_EXPIRED";
    return response.ok ? "ACK" : "RELAY_ERROR";
  } catch { return "OFFLINE"; }
}

export async function fetchGithubCommitStatuses(
  captureIds: string[],
  settings: CaptureSettings,
  fetcher: typeof fetch = fetch,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS
): Promise<Record<string, GithubCommitStatus>> {
  const relay = settings.relay;
  if (!relay || captureIds.length === 0 || relay.status === "AUTH_EXPIRED" || relay.status === "REVOCATION_PENDING") return {};
  const relayEndpoint = trustedRelayEndpoint(relay.endpoint); if (!relayEndpoint) return {};
  const endpoint = new URL("/api/relay/github-commit-status", relayEndpoint.origin);
  for (const captureId of [...new Set(captureIds)].slice(0, 10)) endpoint.searchParams.append("captureId", captureId);
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { "Authorization": `Bearer ${relay.secret}` } }, timeoutMs);
    if (!response.ok) return {};
    const payload = await response.json() as { statuses?: unknown };
    if (!payload.statuses || typeof payload.statuses !== "object") return {};
    const allowed = new Set<GithubCommitStatus>(["NOT_REQUESTED", "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"]);
    return Object.fromEntries(Object.entries(payload.statuses).filter((entry): entry is [string, GithubCommitStatus] => typeof entry[1] === "string" && allowed.has(entry[1] as GithubCommitStatus)));
  } catch {
    return {};
  }
}

/** Persist only the result for the exact relay snapshot that made the request. */
export async function recordRelayAttempt(store: Pick<CaptureStore, "mutateRelayIfCurrent">, settings: CaptureSettings, result: RelayAttemptResult): Promise<void> {
  if (result === "DISABLED") return;
  const relay = settings.relay;
  if (!relay) return;
  const status = result === "ACK" ? "CONFIRMED" : result;
  await store.mutateRelayIfCurrent(relay, current => ({ ...current, relay: { ...relay, status } }));
}

/** The bearer is intentionally allowed only to revoke itself, never settings. */
export async function revokeRelay(settings: CaptureSettings, fetcher: typeof fetch = fetch, timeoutMs = RELAY_REQUEST_TIMEOUT_MS): Promise<"ACK" | "OFFLINE" | "RELAY_ERROR"> {
  const relay=settings.relay; if(!relay) return "ACK";
  const original = trustedRelayEndpoint(relay.endpoint); if (!original) return "RELAY_ERROR";
  const endpoint = new URL("/api/relay/grants/self", original.origin);
  try { const response=await fetchWithTimeout(fetcher,endpoint,{method:"DELETE",headers:{"Authorization":`Bearer ${relay.secret}`}},timeoutMs); return response.ok||response.status===401?"ACK":"RELAY_ERROR"; } catch {return "OFFLINE";}
}
