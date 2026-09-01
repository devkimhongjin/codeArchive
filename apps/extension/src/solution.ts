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

export interface DashboardImportReceipt {
  importedAt: string;
  importBatchId: string;
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
  autoCapture?: {
    source: "SWEA_AUTO" | "PROGRAMMERS_AUTO";
    result: "ACCEPTED";
    observedAt: string;
    problemUrl?: string;
  };
  /** Immutable Extension-owned capture identity. No account/user ownership is encoded here. */
  clientRecordId?: string;
  /** Dashboard ACK receipt metadata only; local source remains authoritative and retained. */
  dashboardImportReceipt?: DashboardImportReceipt;
  /** Legacy direct-sync metadata retained until replacement E2E and cleanup #86. */
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
