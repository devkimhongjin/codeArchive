import { isJungolHistoryPath } from "./historicalJungol";

export type LocalHistoryCommand = "LOCAL_HISTORY_SCAN_START" | "LOCAL_HISTORY_STATUS" | "LOCAL_HISTORY_IMPORT_START" | "LOCAL_HISTORY_CANCEL";

/** Detail dialogs add sid but must remain on the exact owned listing/account route. */
export function sameHistorySource(listingUrl: string, currentUrl: string): boolean {
  try {
    const listing = new URL(listingUrl); const current = new URL(currentUrl);
    return listing.origin === "https://jungol.co.kr" && current.origin === listing.origin &&
      listing.pathname === current.pathname && isJungolHistoryPath(listing.pathname) &&
      (listing.pathname !== "/submission" || listing.searchParams.get("account") === current.searchParams.get("account"));
  } catch { return false; }
}

/** Polling is read-only. Only an explicit new scan can replace a stale source tab. */
export function mayRediscoverHistorySource(type: LocalHistoryCommand): boolean {
  return type === "LOCAL_HISTORY_SCAN_START";
}

export function mayStoreLocalHistoryCapture(taskIsActive: boolean, cancelling: boolean, listingUrl: string, currentUrl: string): boolean {
  return taskIsActive && !cancelling && sameHistorySource(listingUrl, currentUrl);
}
