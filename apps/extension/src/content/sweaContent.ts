import { sweaAdapter, getSweaPageKind } from "../adapters/swea/sweaAdapter";
import { detectSweaEditor } from "../adapters/swea/sweaEditor";
import { syncSweaEditor } from "../adapters/swea/sweaEditorSync";
import { GET_PAGE_CONTEXT, PAGE_CONTEXT, type GetPageContextMessage, type PageContextMessage } from "./messages";

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: PageContextMessage) => void) => void): void;
    };
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as GetPageContextMessage | undefined)?.type !== GET_PAGE_CONTEXT) return;

  const url = new URL(window.location.href);
  const syncResult = getSweaPageKind(url) === "solving" ? syncSweaEditor(document) : null;
  let result = sweaAdapter.detect(document, url);

  if (result.status === "connected_page" && syncResult?.status === "failed") {
    result = {
      ...result,
      editor: detectSweaEditor(document, url, false),
    };
  }

  sendResponse({ type: PAGE_CONTEXT, result });
});
