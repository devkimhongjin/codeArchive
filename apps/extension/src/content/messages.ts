import type { ProblemDetectionResult } from "../adapters/platformAdapter";

export const GET_PAGE_CONTEXT = "CODEARCHIVE_GET_PAGE_CONTEXT" as const;
export const PAGE_CONTEXT = "CODEARCHIVE_PAGE_CONTEXT" as const;

export interface GetPageContextMessage {
  type: typeof GET_PAGE_CONTEXT;
}

export interface PageContextMessage {
  type: typeof PAGE_CONTEXT;
  result: ProblemDetectionResult;
}
