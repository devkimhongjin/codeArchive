import { sameHistorySource, type LocalHistoryCommand } from "./historyRouting";

type Target = { tabId: number; url: string };
type Message = { type: LocalHistoryCommand; submissionIds?: string[] };
type Services = {
  send: (tabId: number, message: Message) => Promise<unknown>;
  currentUrl: (tabId: number) => Promise<string | undefined>;
  connect: (tabId: number) => Promise<unknown>;
};

/** Only an explicit scan may reconnect a tab left open across extension reloads. */
export async function requestLocalHistoryMessage(target: Target, message: Message, services: Services): Promise<unknown> {
  const sourceStillOpen = async () => {
    try {
      const url = await services.currentUrl(target.tabId);
      return !!url && sameHistorySource(target.url, url);
    } catch { return false; }
  };
  if (!await sourceStillOpen()) return { status: "INTERRUPTED" };
  try { return await services.send(target.tabId, message); }
  catch (error) {
    if (!await sourceStillOpen()) return { status: "INTERRUPTED" };
    // A closed message port may have already started work. Never reinject or
    // replay in that case: only Chrome's missing-receiver error is recoverable.
    const missingReceiver = error instanceof Error && /receiving end does not exist/i.test(error.message);
    if (!missingReceiver) return { status: "CONNECTION_FAILED" };
    if (message.type !== "LOCAL_HISTORY_SCAN_START") return { status: "CONNECTION_REQUIRED" };
    try {
      await services.connect(target.tabId);
      if (!await sourceStillOpen()) return { status: "INTERRUPTED" };
      return await services.send(target.tabId, message);
    } catch { return { status: "CONNECTION_FAILED" }; }
  }
}
