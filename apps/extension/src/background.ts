import { SAVE_SWEA_ACCEPTED, type SaveResponse, type SweaAcceptedCapture } from "./sweaAutoCapture";
import { saveSweaAcceptedCapture } from "./solutionRepository";
declare const chrome: { runtime: { onMessage: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: SaveResponse) => void) => boolean | void): void } } };

function validPerformance(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.executionTime === "string" && p.executionTime.trim().length > 0 && typeof p.memoryUsage === "string" && p.memoryUsage.trim().length > 0;
}

export function valid(value: unknown): value is SweaAcceptedCapture {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return c.platform === "SWEA" && c.result === "ACCEPTED" && ["captureId", "problemNumber", "title", "language", "code", "observedAt", "solvedAt"].every((k) => typeof c[k] === "string" && (c[k] as string).trim()) && validPerformance(c.performance);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as { type?: string; capture?: unknown };
  if (request.type !== SAVE_SWEA_ACCEPTED || !valid(request.capture)) { sendResponse({ status: "rejected", reason: "invalid_capture" }); return; }
  saveSweaAcceptedCapture(request.capture).then(sendResponse).catch(() => sendResponse({ status: "failed", reason: "storage_failed" }));
  return true;
});
