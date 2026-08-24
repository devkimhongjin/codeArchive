export type PlatformCode = "SWEA";

export interface DetectedProblemInfo {
  platform: PlatformCode;
  problemNumber: string;
  title: string;
  difficulty: string | null;
  url: string;
}

export type ProblemDetectionResult =
  | { status: "detected"; problem: DetectedProblemInfo; warnings: string[] }
  | { status: "connected_page"; platform: "SWEA"; pageKind: "solving"; url: string }
  | { status: "unsupported_page" }
  | { status: "incomplete"; missing: string[]; warnings: string[] };

export interface PlatformAdapter {
  platform: PlatformCode;
  matches(url: URL): boolean;
  detect(document: Document, url: URL): ProblemDetectionResult;
}
