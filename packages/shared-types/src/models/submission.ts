import type { ProgrammingLanguage } from "../enums/programming-language";
import type { SubmissionResult } from "../enums/submission-result";
import type { ProblemInfo } from "./problem";

export interface CapturedSubmission {
  problem: ProblemInfo;
  language: ProgrammingLanguage;
  code: string;
  result: SubmissionResult;
  executionTime?: number;
  memoryUsage?: number;
  submittedAt: string;
}