import type { Capture, CaptureSettings } from "./types";
import type { CaptureStore } from "./storage";
import { LEGACY_DASHBOARD_ORIGIN, LEGACY_RELAY_ORIGINS, PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';

/** REJECTED: the server refused this capture's content (4xx). The connection itself is fine. */
export type RelayAttemptResult = "ACK" | "OFFLINE" | "AUTH_EXPIRED" | "RELAY_ERROR" | "DISABLED" | "REJECTED";
export type GithubCommitStatus = "NOT_REQUESTED" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
export const RELAY_REQUEST_TIMEOUT_MS = 8_000;

function relayEndpoint(value: string): URL | null {
  try {
    const endpoint = new URL(value, PUBLIC_API_ORIGIN);
    return endpoint.username || endpoint.password || !endpoint.pathname.startsWith('/api/relay/') ? null : endpoint;
  } catch { return null; }
}

function trustedRelayEndpoint(value: string): URL | null {
  const endpoint = relayEndpoint(value);
  return endpoint && (endpoint.origin === PUBLIC_API_ORIGIN || (LEGACY_RELAY_ORIGINS as readonly string[]).includes(endpoint.origin)) ? endpoint : null;
}

/** Moves an existing opaque grant to the direct host only for the exact persisted
 * account/version snapshot. The grant's scope and secret are unchanged. */
export async function migrateLegacyRelayEndpoint(store: Pick<CaptureStore, 'mutateRelayIfCurrent'>, settings: CaptureSettings): Promise<boolean> {
  const relay = settings.relay, endpoint = relay && relayEndpoint(relay.endpoint);
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
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return "REJECTED";
    return response.ok ? "ACK" : "RELAY_ERROR";
  } catch { return "OFFLINE"; }
}

/** A github.com file page; anything else from the server is dropped. */
export function trustedGithubFileUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.port && !url.username && !url.password && !url.search && !url.hash &&
      /^\/[^/]+\/[^/]+\/blob\/[^/]+\/.+/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export async function fetchGithubCommitStatuses(
  captureIds: string[],
  settings: CaptureSettings,
  fetcher: typeof fetch = fetch,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS
): Promise<Record<string, GithubCommitStatus>> {
  return (await fetchGithubCommitState(captureIds, settings, fetcher, timeoutMs)).statuses;
}

/** Commit statuses, and the github.com page of each committed file the server knows. */
export async function fetchGithubCommitState(
  captureIds: string[],
  settings: CaptureSettings,
  fetcher: typeof fetch = fetch,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS
): Promise<{ statuses: Record<string, GithubCommitStatus>; links: Record<string, string> }> {
  const none = { statuses: {}, links: {} };
  const relay = settings.relay;
  if (!relay || captureIds.length === 0 || relay.status === "AUTH_EXPIRED" || relay.status === "REVOCATION_PENDING") return none;
  const relayEndpoint = trustedRelayEndpoint(relay.endpoint); if (!relayEndpoint) return none;
  const endpoint = new URL("/api/relay/github-commit-status", relayEndpoint.origin);
  const requested = [...new Set(captureIds)].slice(0, 10);
  for (const captureId of requested) endpoint.searchParams.append("captureId", captureId);
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { "Authorization": `Bearer ${relay.secret}` } }, timeoutMs);
    if (!response.ok) return none;
    const payload = await response.json() as { statuses?: unknown; links?: unknown };
    if (!payload.statuses || typeof payload.statuses !== "object") return none;
    const allowed = new Set<GithubCommitStatus>(["NOT_REQUESTED", "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"]);
    const statuses = Object.fromEntries(Object.entries(payload.statuses).filter((entry): entry is [string, GithubCommitStatus] => typeof entry[1] === "string" && allowed.has(entry[1] as GithubCommitStatus)));
    // Servers before the commit page was recorded send no links.
    const links: Record<string, string> = {};
    if (payload.links && typeof payload.links === "object" && !Array.isArray(payload.links)) {
      for (const [captureId, value] of Object.entries(payload.links)) {
        const url = trustedGithubFileUrl(value);
        if (url && requested.includes(captureId) && statuses[captureId] === "SUCCEEDED") links[captureId] = url;
      }
    }
    return { statuses, links };
  } catch {
    return none;
  }
}

/** Reads only source-free previews for the bearer-bound server account. */
export async function fetchRecentServerCaptures(settings: CaptureSettings, fetcher: typeof fetch = fetch): Promise<Omit<Capture, 'sourceCode'>[]> {
  const relay = settings.relay, origin = relay && trustedRelayEndpoint(relay.endpoint);
  if (!relay || !origin || settings.accountId !== relay.accountId || !['CONFIRMED', 'OFFLINE', 'RELAY_ERROR'].includes(relay.status)) return [];
  const response = await fetchWithTimeout(fetcher, new URL('/api/relay/recent', origin.origin), { headers: { Authorization: `Bearer ${relay.secret}` } }, RELAY_REQUEST_TIMEOUT_MS);
  if (response.status === 401) return [];
  if (!response.ok) throw new Error('서버의 최근 풀이를 확인하지 못했습니다.');
  const payload = await response.json() as { captures?: unknown };
  if (!Array.isArray(payload.captures) || payload.captures.length > 3) throw new Error('서버 풀이 응답을 확인하지 못했습니다.');
  return payload.captures.map((record: unknown) => {
    const item = record as Partial<Capture> | null;
    if (!item || typeof item.captureId !== 'string' || !['JUNGOL', 'SWEA', 'PROGRAMMERS'].includes(item.platform ?? '') ||
        typeof item.problemNumber !== 'string' || typeof item.title !== 'string' || typeof item.language !== 'string' ||
        typeof item.observedAt !== 'string' || !Number.isFinite(Date.parse(item.observedAt))) throw new Error('서버 풀이 응답을 확인하지 못했습니다.');
    // Explicit projection: do not retain unexpected source fields from any server response.
    return { captureId: item.captureId, platform: item.platform!, problemNumber: item.problemNumber, title: item.title,
      language: item.language, problemUrl: '', observedAt: item.observedAt, solvedAt: item.solvedAt ?? item.observedAt,
      executionTime: item.executionTime ?? undefined, memoryUsage: item.memoryUsage ?? undefined, memoryValue: item.memoryValue ?? undefined, memoryUnit: item.memoryUnit ?? undefined,
      result: 'ACCEPTED', syncState: 'SYNCED', syncAccountId: relay.accountId };
  });
}
export async function fetchRecentServerCapture(captureId: string, settings: CaptureSettings, fetcher: typeof fetch = fetch): Promise<Capture> {
  const relay = settings.relay, origin = relay && trustedRelayEndpoint(relay.endpoint);
  if (!relay || !origin || settings.accountId !== relay.accountId || !/^[0-9a-f-]{36}$/i.test(captureId)) throw new Error('LOGIN_REQUIRED');
  const response = await fetchWithTimeout(fetcher, new URL(`/api/relay/captures/${captureId}`, origin.origin), { headers: { Authorization: `Bearer ${relay.secret}` } }, RELAY_REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error('SERVER_CAPTURE_UNAVAILABLE');
  const capture = await response.json() as Capture;
  if (capture.captureId !== captureId || capture.result !== 'ACCEPTED' || typeof capture.sourceCode !== 'string' || capture.sourceCode.length > 1_000_000) throw new Error('INVALID_SERVER_CAPTURE');
  return { ...capture, syncState: 'SYNCED', syncAccountId: relay.accountId };
}

/** Persist only the result for the exact relay snapshot that made the request. */
export async function recordRelayAttempt(store: Pick<CaptureStore, "mutateRelayIfCurrent">, settings: CaptureSettings, result: RelayAttemptResult): Promise<void> {
  if (result === "DISABLED") return;
  const relay = settings.relay;
  if (!relay) return;
  const status = result === "ACK" || result === "REJECTED" ? "CONFIRMED" : result;
  await store.mutateRelayIfCurrent(relay, current => ({ ...current, relay: { ...relay, status } }));
}

/** The bearer is intentionally allowed only to revoke itself, never settings. */
export async function revokeRelay(settings: CaptureSettings, fetcher: typeof fetch = fetch, timeoutMs = RELAY_REQUEST_TIMEOUT_MS): Promise<"ACK" | "OFFLINE" | "RELAY_ERROR"> {
  const relay=settings.relay; if(!relay) return "ACK";
  const original = trustedRelayEndpoint(relay.endpoint); if (!original) return "RELAY_ERROR";
  const endpoint = new URL("/api/relay/grants/self", original.origin);
  try { const response=await fetchWithTimeout(fetcher,endpoint,{method:"DELETE",headers:{"Authorization":`Bearer ${relay.secret}`}},timeoutMs); return response.ok||response.status===401?"ACK":"RELAY_ERROR"; } catch {return "OFFLINE";}
}
