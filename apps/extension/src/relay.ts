import type { Capture, CaptureSettings } from "./types";
/** The extension owns no GitHub credential; only this opaque append grant crosses the wire. */
export async function relayCapture(capture: Capture, settings: CaptureSettings, fetcher: typeof fetch = fetch): Promise<"ACK" | "OFFLINE" | "AUTH_EXPIRED" | "RELAY_ERROR" | "DISABLED"> {
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

/** The bearer is intentionally allowed only to revoke itself, never settings. */
export async function revokeRelay(settings: CaptureSettings, fetcher: typeof fetch = fetch): Promise<"ACK" | "OFFLINE" | "RELAY_ERROR"> {
  const relay=settings.relay; if(!relay) return "ACK";
  let endpoint: URL; try { endpoint=new URL("/api/relay/grants/self",new URL(relay.endpoint,"https://codearchive-dashboard-beta.netlify.app").origin); } catch { return "RELAY_ERROR"; }
  if(!(["https://codearchive-dashboard-beta.netlify.app","http://localhost:5173"] as string[]).includes(endpoint.origin))return "RELAY_ERROR";
  try { const response=await fetcher(endpoint,{method:"DELETE",headers:{"Authorization":`Bearer ${relay.secret}`}}); return response.ok||response.status===401?"ACK":"RELAY_ERROR"; } catch {return "OFFLINE";}
}
