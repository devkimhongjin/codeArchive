export type Platform = "SWEA" | "PROGRAMMERS";

export const CAPTURE_RESULT = "ACCEPTED" as const;
export type CaptureResult = typeof CAPTURE_RESULT;
export type SyncState = "PENDING" | "SYNCED";

export interface Capture {
  captureId: string;
  platform: Platform;
  problemNumber: string;
  title: string;
  problemUrl: string;
  language: string;
  sourceCode: string;
  result: CaptureResult;
  observedAt: string;
  solvedAt: string;
  executionTime?: number;
  memoryUsage?: number;
  syncState: SyncState;
  syncedAt?: string;
}

export interface CaptureDraft {
  captureId?: string;
  platform: Platform;
  problemNumber: string;
  title: string;
  problemUrl: string;
  language: string;
  sourceCode: string;
  result: CaptureResult;
  observedAt?: string | Date;
  solvedAt?: string | Date;
  executionTime?: number;
  memoryUsage?: number;
}

export interface ProblemMetadata {
  problemNumber: string;
  title: string;
  problemUrl: string;
}

export interface EditorData {
  language: string;
  sourceCode: string;
}

export interface PerformanceData {
  executionTime?: number;
  memoryUsage?: number;
}

export interface SubmissionResultDetection {
  accepted: true;
  resultText: string;
  element?: Element;
  /** Opaque attempt identity used to avoid consuming a newer click attempt. */
  attemptToken?: object;
}

export interface SubmissionSnapshot {
  problem: ProblemMetadata | null;
  editor: EditorData | null;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  detectProblem(): ProblemMetadata | null;
  detectSubmissionResult(options?: { freshOnly?: boolean }): SubmissionResultDetection | null;
  detectEditor(): EditorData | null;
  collectPerformance(): PerformanceData | null;
  isSubmitControl(element: Element): boolean;
  beginSubmissionAttempt(now?: Date): void;
  consumeSubmissionResult(detection: SubmissionResultDetection): void;
  getSubmissionSnapshot?(): SubmissionSnapshot | null;
}

export interface CaptureSettings {
  autoSyncEnabled: boolean;
  githubAutoCommitEnabled: boolean;
  githubTargetConfigured: boolean;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  autoSyncEnabled: false,
  githubAutoCommitEnabled: false,
  githubTargetConfigured: false
};
