import type { Platform } from "./types";
import { isJungolHistoryPath, isJungolHistorySenderUrl } from "./historicalJungol";

export type LocalHistoryCommand = "LOCAL_HISTORY_SCAN_START" | "LOCAL_HISTORY_STATUS" | "LOCAL_HISTORY_IMPORT_START" | "LOCAL_HISTORY_CANCEL";

/** Only the packaged history page, top-level or inside our dashboard, owns local collection. */
export function isLocalHistoryPageSender(sender: { id?: string; frameId?: number; url?: string; tab?: { id?: number; url?: string } }, extensionId: string): boolean {
  if (sender.id !== extensionId || !Number.isInteger(sender.frameId) || sender.frameId! < 0 || !sender.url) return false;
  const ownPage = (value: string, path: string) => {
    const url = new URL(value);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && url.pathname === path;
  };
  try {
    if (!ownPage(sender.url, '/history.html')) return false;
    if (sender.frameId === 0) return true;
    return Number.isInteger(sender.tab?.id) && sender.tab!.id! >= 0 && !!sender.tab?.url && ownPage(sender.tab.url, '/dashboard.html');
  } catch { return false; }
}

export function historyPlatformForUrl(value: string | URL): Platform | null {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (url.origin === "https://jungol.co.kr" && isJungolHistorySenderUrl(url)) return "JUNGOL";
    if (url.origin === "https://swexpertacademy.com" && url.pathname === "/main/userpage/code/userSubmitProblem.do") return "SWEA";
    if (url.origin === "https://school.programmers.co.kr" && url.pathname === "/learn/challenges" &&
        url.searchParams.get("statuses") === "solved,solved_with_unlock") return "PROGRAMMERS";
  } catch { /* invalid URLs do not own an import route */ }
  return null;
}

/** A platform route can only remain bound to its own exact listing page. */
export function sameHistorySource(listingUrl: string, currentUrl: string, platform: Platform | null = historyPlatformForUrl(listingUrl)): boolean {
  try {
    const listing = new URL(listingUrl); const current = new URL(currentUrl);
    if (!platform || listing.origin !== current.origin || historyPlatformForUrl(current) !== platform) return false;
    if (platform === "JUNGOL") return listing.pathname === current.pathname &&
      (listing.pathname !== "/submission" || listing.searchParams.get("account") === current.searchParams.get("account"));
    if (platform === "SWEA") return listing.pathname === current.pathname;
    return listing.pathname === current.pathname && listing.searchParams.get("statuses") === current.searchParams.get("statuses");
  } catch { return false; }
}

/** Polling is read-only. Only an explicit new scan can replace a stale source tab. */
export function mayRediscoverHistorySource(type: LocalHistoryCommand): boolean { return type === "LOCAL_HISTORY_SCAN_START"; }

export function mayStoreLocalHistoryCapture(taskIsActive: boolean, cancelling: boolean, listingUrl: string, currentUrl: string,
  platform: Platform = "JUNGOL"): boolean {
  return taskIsActive && !cancelling && sameHistorySource(listingUrl, currentUrl, platform);
}

/** Sender and routed source must be tied to the same platform. */
export function mayStoreHistoricalFromSender(senderUrl: string, currentUrl: string, tabId: number,
  route: { tabId: number; url: string; status: string; platform?: Platform } | null, platform: Platform = "JUNGOL"): boolean {
  try {
    const sender = new URL(senderUrl), current = new URL(currentUrl);
    if (historyPlatformForUrl(current) !== platform) return false;
    if (historyPlatformForUrl(sender) === platform && !!route && route.tabId === tabId && route.platform === platform &&
        (route.status === "IMPORTING" || route.status === "CANCELLING") && sameHistorySource(route.url, currentUrl, platform) &&
        sameHistorySource(senderUrl, currentUrl, platform)) return true;
    // Retain the old same-document Jungol detail contract for a verified
    // listing sender after a service-worker restart. New platforms always
    // require their persisted platform route.
    if (platform === "JUNGOL" && !route && isJungolHistorySenderUrl(sender) && sameHistorySource(senderUrl, currentUrl, platform)) return true;
    return platform === "JUNGOL" && sender.origin === "https://jungol.co.kr" && !isJungolHistoryPath(sender.pathname) && !!route && route.tabId === tabId &&
      (route.platform ?? "JUNGOL") === platform && (route.status === "IMPORTING" || route.status === "CANCELLING") &&
      sameHistorySource(route.url, currentUrl, platform);
  } catch { return false; }
}
