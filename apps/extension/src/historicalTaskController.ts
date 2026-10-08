export type HistoricalImportState = {
  status: "IMPORTING" | "CANCELLING" | "DONE" | "INTERRUPTED" | "FAILED";
  completed: number; total: number; saved: number; duplicate: number; skipped: number;
  /** Wall-clock ownership timestamps, retained by the content-owned task. */
  startedAt?: number; endedAt?: number; lastProgressAt?: number;
  failureReason?: HistoricalImportFailureReason;
  failedSubmissionIds?: string[];
  /** Exactly the selected submissions whose verified store step succeeded. */
  storedSubmissionIds?: string[];
};

export type HistoricalImportFailureReason = "LIST_CHANGED" | "DETAIL_NOT_FOUND" | "DETAIL_UNVERIFIED" |
  "STORE_REJECTED" | "STORE_FAILED" | "IMPORT_FAILED";
export class HistoricalImportFailure extends Error {
  constructor(readonly reason: HistoricalImportFailureReason) { super(reason); }
}

export type HistoricalImportResult = { saved: number; duplicate: number; skipped: number;
  failedSubmissionId?: string };

/** Content-owned sequential lifetime. Its caller supplies the DOM verifier/store step. */
export class HistoricalTaskController<T> {
  state: HistoricalImportState | null = null;
  private active: Promise<void> | null = null;
  private cancelling = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  start(items: T[], run: (item: T, mayStore: () => boolean) => Promise<HistoricalImportResult>,
    onItemSettled?: (item: T, result: HistoricalImportResult) => void,
    submissionId?: (item: T) => string): boolean {
    if (this.active || items.length < 1) return false;
    this.cancelling = false;
    const startedAt = this.now();
    this.state = { status: "IMPORTING", completed: 0, total: items.length, saved: 0, duplicate: 0, skipped: 0, startedAt, lastProgressAt: startedAt,
      ...(submissionId ? { storedSubmissionIds: [] } : {}) };
    this.active = (async () => {
      for (const item of items) {
        if (this.cancelling) break;
        const result = await run(item, () => !this.cancelling);
        // A store dispatched before cancel is intentionally counted after it settles.
        onItemSettled?.(item, result);
        this.state = { ...this.state!, completed: this.state!.completed + 1, saved: this.state!.saved + result.saved,
          duplicate: this.state!.duplicate + result.duplicate, skipped: this.state!.skipped + result.skipped,
          ...(submissionId && result.saved + result.duplicate > 0 && result.skipped === 0 && !result.failedSubmissionId
            ? { storedSubmissionIds: [...new Set([...(this.state!.storedSubmissionIds ?? []), submissionId(item)])] } : {}),
          ...(result.failedSubmissionId ? { failedSubmissionIds: [...(this.state!.failedSubmissionIds ?? []), result.failedSubmissionId] } : {}),
          status: this.cancelling ? "CANCELLING" : "IMPORTING", lastProgressAt: this.now() };
        if (this.cancelling) break;
      }
      this.state = { ...this.state!, status: this.cancelling ? "INTERRUPTED" : "DONE", endedAt: this.now() };
    })().catch(error => { this.state = { ...this.state!, status: this.cancelling ? "INTERRUPTED" : "FAILED", endedAt: this.now(),
      failureReason: error instanceof HistoricalImportFailure ? error.reason : "IMPORT_FAILED" }; })
      .finally(() => { this.active = null; });
    return true;
  }

  cancel(): void {
    if (!this.active || !this.state || this.cancelling) return;
    this.cancelling = true;
    this.state = { ...this.state, status: "CANCELLING" };
  }

  mayStore(): boolean { return !!this.active && !this.cancelling; }
  get isActive(): boolean { return this.active !== null; }
  async settled(): Promise<void> { await this.active; }
}
