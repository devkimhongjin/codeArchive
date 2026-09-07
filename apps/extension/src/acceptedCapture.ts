export type AutoCapturePlatform = "SWEA" | "PROGRAMMERS";
export type AcceptedCaptureSource = "SWEA_AUTO" | "PROGRAMMERS_AUTO";

export interface AcceptedCapture {
  captureId: string;
  platform: AutoCapturePlatform;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  result: "ACCEPTED";
  observedAt: string;
  solvedAt: string;
  problemUrl?: string;
  performance?: {
    executionTime: string;
    memoryUsage: string;
  };
}

export const SAVE_ACCEPTED_CAPTURE = "CODEARCHIVE_SAVE_ACCEPTED_CAPTURE" as const;

export function captureSource(platform: AutoCapturePlatform): AcceptedCaptureSource {
  return platform === "SWEA" ? "SWEA_AUTO" : "PROGRAMMERS_AUTO";
}

export function isAutoCapturePlatform(value: unknown): value is AutoCapturePlatform {
  return value === "SWEA" || value === "PROGRAMMERS";
}
