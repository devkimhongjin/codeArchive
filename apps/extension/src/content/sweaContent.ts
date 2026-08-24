import { createSweaSubmissionResultStore } from "./sweaSubmissionResultStore";
import { getSweaPageContext } from "./sweaPageContext";
import { GET_PAGE_CONTEXT, PAGE_CONTEXT, type GetPageContextMessage, type PageContextMessage } from "./messages";

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: PageContextMessage) => void) => void): void;
    };
  };
};

const initialUrl = new URL(window.location.href);
const submissionResultStore = createSweaSubmissionResultStore(document, initialUrl);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as GetPageContextMessage | undefined)?.type !== GET_PAGE_CONTEXT) return;

  const url = new URL(window.location.href);
  const result = getSweaPageContext(document, url, submissionResultStore.getState());

  sendResponse({ type: PAGE_CONTEXT, result });
});
