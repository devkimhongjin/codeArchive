import type { Capture } from "./types";

export function formatSolutionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatExecutionTime(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${value} ms` : "정보 없음";
}

export function formatCaptureMemory(capture: Pick<Capture, "memoryValue" | "memoryUnit" | "memoryUsage">): string {
  if (capture.memoryValue !== undefined && Number.isFinite(capture.memoryValue) && capture.memoryValue >= 0 && capture.memoryUnit && capture.memoryUnit !== "UNKNOWN") {
    return `${capture.memoryValue} ${capture.memoryUnit}`;
  }
  if (capture.memoryUsage !== undefined && Number.isFinite(capture.memoryUsage) && capture.memoryUsage >= 0) {
    return `${capture.memoryUsage} · 단위 미확인`;
  }
  return "정보 없음";
}
