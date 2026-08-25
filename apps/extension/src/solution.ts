export type AiUsage = "used" | "not_used" | "unknown";

export interface SubmissionPerformance {
  executionTime: string;
  memoryUsage: string;
}

export type SolutionSyncState = "synced" | "retryable";

export interface SolutionSyncMetadata {
  state: SolutionSyncState;
  userKey?: string;
  serverSolutionId?: string;
  lastAttemptAt: string;
  lastSyncedAt?: string;
}

export interface SolutionRecord {
  id: string;
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  solvedAt: string | null;
  aiUsage: AiUsage;
  createdAt: string;
  updatedAt: string;
  performance?: SubmissionPerformance;
  autoCapture?: { source: "SWEA_AUTO"; result: "ACCEPTED"; observedAt: string };
  sync?: SolutionSyncMetadata;
}

export interface NewSolutionInput {
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  solvedAt: string | null;
  aiUsage: AiUsage;
  performance?: SubmissionPerformance;
}
