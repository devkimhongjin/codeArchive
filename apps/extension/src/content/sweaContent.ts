import { createSweaSubmissionResultStore } from "./sweaSubmissionResultStore";
import { getSweaPageContext } from "./sweaPageContext";
import { captureAccepted, type SweaAutoSaveState } from "../sweaAutoCapture";
import { GET_PAGE_CONTEXT, PAGE_CONTEXT, type GetPageContextMessage, type PageContextMessage } from "./messages";
import { getSweaPageKind } from "../adapters/swea/sweaAdapter";
import { detailProblemContestId, SWEA_CONSUME_PROBLEM_CONTEST_ID, SWEA_STORE_PROBLEM_CONTEST_ID } from "../sweaProblemIdentityHandoff";

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: PageContextMessage) => void) => void): void;
    };
  };
};

const initialUrl = new URL(window.location.href);
let autoSave: SweaAutoSaveState = { status: "idle" };
const pageKind = getSweaPageKind(initialUrl);
if (pageKind === "problem_detail") {
  const problemContestId = detailProblemContestId(document, initialUrl);
  if (problemContestId) void chrome.runtime.sendMessage({ type: SWEA_STORE_PROBLEM_CONTEST_ID, problemContestId });
}

const problemContestIdPromise: Promise<string | null> = pageKind === "solving"
  ? chrome.runtime.sendMessage({ type: SWEA_CONSUME_PROBLEM_CONTEST_ID, origin: initialUrl.origin, path: initialUrl.pathname })
    .then((response) => (response as { problemContestId?: unknown })?.problemContestId)
    .then((value) => typeof value === "string" && value.trim() ? value.trim() : null)
    .catch(() => null)
  : Promise.resolve(null);

const submissionResultStore = createSweaSubmissionResultStore(document, initialUrl, undefined, async (observation) => {
  if (observation.submission.result !== "ACCEPTED") return;
  autoSave = { status: "saving", observedAt: observation.submission.observedAt };
  const problemContestId = await problemContestIdPromise;
  autoSave = await captureAccepted(document, new URL(window.location.href), observation, (message) => chrome.runtime.sendMessage(message) as Promise<any>, undefined, undefined, undefined, problemContestId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as GetPageContextMessage | undefined)?.type !== GET_PAGE_CONTEXT) return;

  const url = new URL(window.location.href);
  const result = getSweaPageContext(document, url, submissionResultStore.getState(), autoSave);

  sendResponse({ type: PAGE_CONTEXT, result });
});
