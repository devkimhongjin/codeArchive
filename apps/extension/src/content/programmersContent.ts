import { observeProgrammersSubmissionResult, type ProgrammersSubmissionResultState } from "../adapters/programmers/programmersSubmissionResult";
import { captureProgrammersAccepted, type ProgrammersAutoSaveState } from "../programmersAutoCapture";
import { GET_PAGE_CONTEXT, PAGE_CONTEXT, type GetPageContextMessage, type PageContextMessage } from "./messages";
import { getProgrammersPageContext } from "./programmersPageContext";

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: PageContextMessage) => void) => void): void;
    };
  };
};

let submissionResult: ProgrammersSubmissionResultState = { status: "none" };
let autoSave: ProgrammersAutoSaveState = { status: "idle" };

observeProgrammersSubmissionResult(document, async (observation, cycle) => {
  submissionResult = observation;
  autoSave = { status: "saving", observedAt: observation.submission.observedAt };
  autoSave = await captureProgrammersAccepted(
    document,
    new URL(window.location.href),
    observation,
    (message) => chrome.runtime.sendMessage(message) as Promise<any>,
    undefined,
    cycle,
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as GetPageContextMessage | undefined)?.type !== GET_PAGE_CONTEXT) return;
  sendResponse({
    type: PAGE_CONTEXT,
    result: getProgrammersPageContext(
      document,
      new URL(window.location.href),
      submissionResult,
      autoSave,
    ),
  });
});
