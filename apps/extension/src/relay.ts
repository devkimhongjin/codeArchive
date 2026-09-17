import type { Capture, CaptureSettings } from "./types";
import type { CaptureStore } from "./storage";

export type RelayAttemptResult = "ACK" | "OFFLINE" | "AUTH_EXPIRED" | "RELAY_ERROR" | "DISABLED";
export type GithubCommitStatus = "NOT_REQUESTED" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";

/** The extension owns no GitHub credential; only this narrow capture relay grant crosses the wire. */
export async function relayCapture(capture: Capture, settings: CaptureSettings, fetcher: typeof fetch = fetch): Promise<RelayAttemptResult> {
  const relay = settings.relay;
  if (!settings.autoSyncEnabled || !relay || relay.status === "AUTH_EXPIRED") return "DISABLED";
  if (relay.status !== "CONFIRMED" && relay.status !== "OFFLINE" && relay.status !== "RELAY_ERROR") return "DISABLED";
  let endpoint: URL; try { endpoint = new URL(relay.endpoint, "https://codearchive-dashboard-beta.netlify.app"); } catch { return "RELAY_ERROR"; }
  if (!(["https://codearchive-dashboard-beta.netlify.app", "http://localhost:5173"] as string[]).includes(endpoint.origin) || !endpoint.pathname.startsWith("/api/relay/")) return "RELAY_ERROR";
  try {
    const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${relay.secret}` }, body: JSON.stringify(capture) });
    if (response.status === 401) return "AUTH_EXPIRED";
    return response.ok ? "ACK" : "RELAY_ERROR";
  } catch { return "OFFLINE"; }
}

export async function fetchGithubCommitStatuses(
  captureIds: string[],
  settings: CaptureSettings,
  fetcher: typeof fetch = fetch
): Promise<Record<string, GithubCommitStatus>> {
  const relay = settings.relay;
  if (!relay || captureIds.length === 0 || relay.status === "AUTH_EXPIRED" || relay.status === "REVOCATION_PENDING") return {};
  let endpoint: URL;
  try {
    endpoint = new URL("/api/relay/github-commit-status", new URL(relay.endpoint, "https://codearchive-dashboard-beta.netlify.app").origin);
  } catch {
    return {};
  }
  if (!("https://codearchive-dashboard-beta.netlify.app" === endpoint.origin || "http://localhost:5173" === endpoint.origin)) return {};
  for (const captureId of [...new Set(captureIds)].slice(0, 10)) endpoint.searchParams.append("captureId", captureId);
  try {
    const response = await fetcher(endpoint, { headers: { "Authorization": `Bearer ${relay.secret}` } });
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
export async function revokeRelay(settings: CaptureSettings, fetcher: typeof fetch = fetch): Promise<"ACK" | "OFFLINE" | "RELAY_ERROR"> {
  const relay=settings.relay; if(!relay) return "ACK";
  let endpoint: URL; try { endpoint=new URL("/api/relay/grants/self",new URL(relay.endpoint,"https://codearchive-dashboard-beta.netlify.app").origin); } catch { return "RELAY_ERROR"; }
  if(!(["https://codearchive-dashboard-beta.netlify.app","http://localhost:5173"] as string[]).includes(endpoint.origin))return "RELAY_ERROR";
  try { const response=await fetcher(endpoint,{method:"DELETE",headers:{"Authorization":`Bearer ${relay.secret}`}}); return response.ok||response.status===401?"ACK":"RELAY_ERROR"; } catch {return "OFFLINE";}
}
