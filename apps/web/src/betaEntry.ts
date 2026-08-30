import { MAIN_API_ORIGIN } from "./authClient";
import { withRequestDeadline } from "./requestDeadline";

export const BETA_ENTRY_KEY = "codearchive.beta-entry.v1";
export type EntryResult = "accepted" | "incorrect" | "unavailable";
export type EntryCheck = (password: string, signal?: AbortSignal) => Promise<EntryResult>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createEntryCheck(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): EntryCheck {
  return async (password, signal) => {
    try {
      return await withRequestDeadline<EntryResult>(async (requestSignal) => {
        const response = await fetcher(`${MAIN_API_ORIGIN}/api/v1/beta/access`, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
          signal: requestSignal,
        });
        if (response.status === 403) return "incorrect";
        if (!response.ok) return "unavailable";
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null || !("success" in body) || body.success !== true
          || !("data" in body) || typeof body.data !== "object" || body.data === null
          || !("accepted" in body.data) || body.data.accepted !== true) return "unavailable";
        return "accepted";
      }, signal);
    } catch {
      return "unavailable";
    }
  };
}

// A tab-local convenience flag, deliberately not an API credential or security boundary.
export const tabEntry = {
  accepted(): boolean {
    try { return globalThis.sessionStorage.getItem(BETA_ENTRY_KEY) === "accepted"; }
    catch { return false; }
  },
  remember(): void {
    try { globalThis.sessionStorage.setItem(BETA_ENTRY_KEY, "accepted"); }
    catch { /* Current mounted screen still works; reload will ask again. */ }
  },
};

export const checkBetaEntry = createEntryCheck();
