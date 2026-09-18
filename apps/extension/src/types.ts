export type Platform = "SWEA" | "PROGRAMMERS";
export const DEFAULT_DOWNLOAD_FILENAME_TEMPLATE = "Solution_{number}_{name}";

export const CAPTURE_RESULT = "ACCEPTED" as const;
export type CaptureResult = typeof CAPTURE_RESULT;
export type SyncState = "PENDING" | "SYNCED";
export type MemoryUnit = "KB" | "KiB" | "MB" | "MiB" | "UNKNOWN";

export interface Capture {
  captureId: string;
  platform: Platform;
  problemNumber: string;
  title: string;
  problemUrl: string;
  language: string;
  /** Stable filter/export key. Missing only on records written by older builds. */
  languageKey?: string;
  sourceCode: string;
  result: CaptureResult;
  observedAt: string;
  solvedAt: string;
  executionTime?: number;
  memoryUsage?: number;
  memoryValue?: number;
  memoryUnit?: MemoryUnit;
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
  languageKey?: string;
  sourceCode: string;
  result: CaptureResult;
  observedAt?: string | Date;
  solvedAt?: string | Date;
  executionTime?: number;
  memoryUsage?: number;
  memoryValue?: number;
  memoryUnit?: MemoryUnit;
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
  memoryValue?: number;
  memoryUnit?: MemoryUnit;
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
  collectPerformanceAsync?(capture: Capture): Promise<PerformanceData | null>;
  isSubmitControl(element: Element): boolean;
  beginSubmissionAttempt(now?: Date): void;
  consumeSubmissionResult(detection: SubmissionResultDetection): void;
  getSubmissionSnapshot?(): SubmissionSnapshot | null;
}

export interface CaptureSettings {
  autoSyncEnabled: boolean;
  /** Device-local preference; it is never overwritten by dashboard relay settings. */
  autoDownloadEnabled: boolean;
  githubAutoCommitEnabled: boolean;
  githubTargetConfigured: boolean;
  /** Opaque server relay data only: never GitHub/OAuth credentials. */
  relay?: { endpoint: string; secret: string; accountId: string; generation: number; status: "CONFIRMED" | "PENDING" | "OFFLINE" | "AUTH_EXPIRED" | "RELAY_ERROR" | "REVOCATION_PENDING" };
  copyHeader?: boolean;
  downloadHeader?: boolean;
  downloadFilenameTemplate?: string;
  gitPathTemplate?: string;
  name?: string;
  nickname?: string;
  /** Immutable CodeArchive account identity; never an OAuth or GitHub token. */
  accountId?: string;
  /** Monotonic server settings version; used only to reject stale bridge configuration. */
  accountSettingsVersion?: number;
  lightTheme?: "github-light" | "vitesse-light" | "catppuccin-latte" | "solarized-light" | "one-light";
  darkTheme?: "github-dark" | "vitesse-dark" | "catppuccin-mocha" | "dracula" | "one-dark-pro";
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  autoSyncEnabled: false,
  autoDownloadEnabled: false,
  githubAutoCommitEnabled: false,
  githubTargetConfigured: false,
  downloadFilenameTemplate: DEFAULT_DOWNLOAD_FILENAME_TEMPLATE
};
