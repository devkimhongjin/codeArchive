import type { SweaEditorDetectionResult } from "./swea/sweaEditor";
import type { SweaSolvingProblemMetaResult } from "./swea/sweaSolvingProblemMeta";
import type { SweaSubmissionResultState } from "./swea/sweaSubmissionResult";
import type { SweaAutoSaveState } from "../sweaAutoCapture";
import type { ProgrammersEditorDetectionResult } from "./programmers/programmersEditor";
import type { ProgrammersSubmissionResultState } from "./programmers/programmersSubmissionResult";
import type { ProgrammersAutoSaveState } from "../programmersAutoCapture";

export type PlatformCode = "SWEA" | "PROGRAMMERS";

export interface DetectedProblemInfo {
  platform: PlatformCode;
  problemNumber: string;
  title: string;
  difficulty: string | null;
  url: string;
}

export type ProblemDetectionResult =
  | { status: "detected"; problem: DetectedProblemInfo; warnings: string[] }
  | {
      status: "connected_page";
      platform: "SWEA";
      pageKind: "solving";
      url: string;
      metadata: SweaSolvingProblemMetaResult;
      editor: SweaEditorDetectionResult;
      submissionResult: SweaSubmissionResultState;
      autoSave?: SweaAutoSaveState;
    }
  | {
      status: "connected_page";
      platform: "PROGRAMMERS";
      pageKind: "lesson";
      url: string;
      problem: DetectedProblemInfo;
      editor: ProgrammersEditorDetectionResult;
      submissionResult: ProgrammersSubmissionResultState;
      autoSave?: ProgrammersAutoSaveState;
    }
  | { status: "unsupported_page" }
  | { status: "incomplete"; missing: string[]; warnings: string[] };

export interface PlatformAdapter {
  platform: PlatformCode;
  matches(url: URL): boolean;
  detect(document: Document, url: URL): ProblemDetectionResult;
}
