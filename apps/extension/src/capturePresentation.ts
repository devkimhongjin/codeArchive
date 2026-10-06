import type { Capture } from "./types";
import { formatKstDateTime } from "../../../shared/timePresentation";

export function formatSolutionTime(value: string): string {
  return formatKstDateTime(value);
}

export function formatExecutionTime(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${Math.floor(value)} ms` : "정보 없음";
}

export function formatCaptureMemory(capture: Pick<Capture, "memoryValue" | "memoryUnit" | "memoryUsage">): string {
  if (capture.memoryValue !== undefined && Number.isFinite(capture.memoryValue) && capture.memoryValue >= 0 && capture.memoryUnit && capture.memoryUnit !== "UNKNOWN") {
    return `${Math.floor(capture.memoryValue)} ${capture.memoryUnit}`;
  }
  if (capture.memoryUsage !== undefined && Number.isFinite(capture.memoryUsage) && capture.memoryUsage >= 0) {
    return `${Math.floor(capture.memoryUsage)} · 단위 미확인`;
  }
  return "정보 없음";
}
