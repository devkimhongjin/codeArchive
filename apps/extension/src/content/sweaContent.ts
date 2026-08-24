import { sweaAdapter } from "../adapters/swea/sweaAdapter";
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

  sendResponse({
    type: PAGE_CONTEXT,
    result: sweaAdapter.detect(document, new URL(window.location.href)),
  });
});
