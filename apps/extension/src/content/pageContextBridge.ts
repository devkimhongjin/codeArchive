import type { ProblemDetectionResult } from "../adapters/platformAdapter";
import { GET_PAGE_CONTEXT, PAGE_CONTEXT, type PageContextMessage } from "./messages";

declare const chrome: {
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: { type: typeof GET_PAGE_CONTEXT }): Promise<PageContextMessage>;
  };
};

export type PageContextState =
  | { status: "loading" }
  | { status: "connected"; result: ProblemDetectionResult }
  | { status: "unavailable" };

export async function requestCurrentPageContext(): Promise<PageContextState> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { status: "unavailable" };
    const response = await chrome.tabs.sendMessage(tab.id, { type: GET_PAGE_CONTEXT });
    if (!response || response.type !== PAGE_CONTEXT) return { status: "unavailable" };
    return { status: "connected", result: response.result };
  } catch {
    return { status: "unavailable" };
  }
}
