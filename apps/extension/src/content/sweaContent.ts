import { createSweaSubmissionResultStore } from "./sweaSubmissionResultStore";
import { getSweaPageContext } from "./sweaPageContext";
import { captureAccepted, type SweaAutoSaveState } from "../sweaAutoCapture";
import { seedSweaFamilyContext } from "./sweaFamilyContextSeed";
import { GET_PAGE_CONTEXT, PAGE_CONTEXT, type GetPageContextMessage, type PageContextMessage } from "./messages";

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: PageContextMessage) => void) => void): void;
    };
  };
};

const initialUrl = new URL(window.location.href);
try {
  seedSweaFamilyContext(document, initialUrl, document.referrer, sessionStorage);
} catch {
  // Family context is only a fail-closed performance fallback hint.
}

let autoSave: SweaAutoSaveState = { status: "idle" };
const submissionResultStore = createSweaSubmissionResultStore(document, initialUrl, undefined, async (observation) => {
  if (observation.submission.result !== "ACCEPTED") return;
  autoSave = { status: "saving", observedAt: observation.submission.observedAt };
  autoSave = await captureAccepted(document, new URL(window.location.href), observation, (message) => chrome.runtime.sendMessage(message) as Promise<any>);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as GetPageContextMessage | undefined)?.type !== GET_PAGE_CONTEXT) return;

  const url = new URL(window.location.href);
  const result = getSweaPageContext(document, url, submissionResultStore.getState(), autoSave);

  sendResponse({ type: PAGE_CONTEXT, result });
});
