import type { PerformanceData } from "../types";
import { isVisible, normalizeText } from "./dom";

export interface JungolAcceptedResult {
  element: Element;
  signature: string;
  performance: PerformanceData;
}

function closeButtons(element: Element): HTMLButtonElement[] {
  return [...element.querySelectorAll<HTMLButtonElement>("button")].filter(button =>
    button.getAttribute("aria-label") === "닫기" ||
    normalizeText(button.textContent).endsWith("닫기") ||
    [...button.querySelectorAll("*")].some(child => child.children.length === 0 && normalizeText(child.textContent) === "닫기")
  );
}

/** Read only Jungol's visible, complete 100-point submission result dialog. */
export function jungolAcceptedResult(document: Document): JungolAcceptedResult | null {
  const titles = [...document.querySelectorAll<HTMLElement>('h2[id^="dialog-title-"]')]
    .filter(title => normalizeText(title.textContent) === "정답이에요!" && isVisible(title));
  if (titles.length !== 1) return null;
  const title = titles[0]!;
  const suffix = title.id.slice("dialog-title-".length);
  if (!/^\d+$/.test(suffix)) return null;
  const description = document.getElementById(`dialog-desc-${suffix}`);
  if (!description) return null;

  const dialog = title.closest('[role="dialog"][aria-modal="true"]');
  if (!dialog || dialog.getAttribute("aria-labelledby") !== title.id ||
      dialog.getAttribute("aria-describedby") !== description.id || !dialog.contains(description) ||
      !isVisible(dialog) || !isVisible(description) || !closeButtons(dialog).some(isVisible)) return null;

  const signature = normalizeText(description.textContent);
  const match = signature.match(/^정답\s*100점\s*(\d+(?:\.\d+)?)\s*ms\s*(\d[\d,]*(?:\.\d+)?)\s*(KB|KiB|MB|MiB)(?:\s*다음 문제도 풀어볼까요\?(?:\s*다음 문제[\s\S]*)?)?$/);
  if (!match) return null;
  const executionTime = Number(match[1]);
  const memoryValue = Number(match[2]!.replace(/,/g, ""));
  if (!Number.isFinite(executionTime) || !Number.isFinite(memoryValue)) return null;
  const memoryUnit = match[3] as "KB" | "KiB" | "MB" | "MiB";
  const memoryUsage = memoryUnit === "KB" || memoryUnit === "KiB" ? memoryValue / 1024 : memoryValue;
  return { element: dialog, signature, performance: { executionTime, memoryValue, memoryUnit, memoryUsage } };
}
