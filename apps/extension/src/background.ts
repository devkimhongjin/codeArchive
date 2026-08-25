import { SAVE_SWEA_ACCEPTED, type SaveResponse, type SweaAcceptedCapture } from "./sweaAutoCapture";
import { indexedDbSolutionRepository, saveSweaAcceptedCapture } from "./solutionRepository";
import { syncSolutionRecord, unauthenticatedAuthProvider, type SolutionSyncDependencies } from "./solutionSync";

declare const chrome: { runtime: { onMessage: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: SaveResponse) => void) => boolean | void): void } } };

export function valid(value: unknown): value is SweaAcceptedCapture {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return c.platform === "SWEA" && c.result === "ACCEPTED" && ["captureId", "problemNumber", "title", "language", "code", "observedAt", "solvedAt"].every((k) => typeof c[k] === "string" && (c[k] as string).trim());
}

interface CaptureSyncDependencies {
  saveCapture(capture: SweaAcceptedCapture): Promise<SaveResponse>;
  sync: SolutionSyncDependencies;
}

export async function saveThenSyncAcceptedCapture(capture: SweaAcceptedCapture, dependencies: CaptureSyncDependencies): Promise<SaveResponse> {
  const localResult = await dependencies.saveCapture(capture);
  if (localResult.status === "saved" || localResult.status === "duplicate") {
    void syncSolutionRecord(localResult.solutionId, dependencies.sync).catch(() => undefined);
  }
  return localResult;
}

const defaultDependencies: CaptureSyncDependencies = {
  saveCapture: saveSweaAcceptedCapture,
  sync: {
    repository: indexedDbSolutionRepository,
    authProvider: unauthenticatedAuthProvider,
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as { type?: string; capture?: unknown };
  if (request.type !== SAVE_SWEA_ACCEPTED || !valid(request.capture)) {
    sendResponse({ status: "rejected", reason: "invalid_capture" });
    return;
  }
  saveThenSyncAcceptedCapture(request.capture, defaultDependencies)
    .then(sendResponse)
    .catch(() => sendResponse({ status: "failed", reason: "storage_failed" }));
  return true;
});
