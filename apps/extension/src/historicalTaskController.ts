export type HistoricalImportState = {
  status: "IMPORTING" | "CANCELLING" | "DONE" | "INTERRUPTED" | "FAILED";
  completed: number; total: number; saved: number; duplicate: number; skipped: number;
};

export type HistoricalImportResult = { saved: number; duplicate: number; skipped: number };

/** Content-owned sequential lifetime. Its caller supplies the DOM verifier/store step. */
export class HistoricalTaskController<T> {
  state: HistoricalImportState | null = null;
  private active: Promise<void> | null = null;
  private cancelling = false;

  start(items: T[], run: (item: T, mayStore: () => boolean) => Promise<HistoricalImportResult>): boolean {
    if (this.active || items.length < 1) return false;
    this.cancelling = false;
    this.state = { status: "IMPORTING", completed: 0, total: items.length, saved: 0, duplicate: 0, skipped: 0 };
    this.active = (async () => {
      for (const item of items) {
        if (this.cancelling) break;
        const result = await run(item, () => !this.cancelling);
        // A store dispatched before cancel is intentionally counted after it settles.
        this.state = { ...this.state!, completed: this.state!.completed + 1, saved: this.state!.saved + result.saved,
          duplicate: this.state!.duplicate + result.duplicate, skipped: this.state!.skipped + result.skipped,
          status: this.cancelling ? "CANCELLING" : "IMPORTING" };
        if (this.cancelling) break;
      }
      this.state = { ...this.state!, status: this.cancelling ? "INTERRUPTED" : "DONE" };
    })().catch(() => { this.state = { ...this.state!, status: this.cancelling ? "INTERRUPTED" : "FAILED" }; })
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
