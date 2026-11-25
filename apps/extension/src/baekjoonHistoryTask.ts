import { HistoricalTaskController, type HistoricalImportResult } from "./historicalTaskController";
import { baekjoonListingUrl, isBaekjoonHistoryCandidate, type BaekjoonHistoryCandidate } from "./historicalBaekjoon";
import { BAEKJOON_ORIGIN } from "./adapters/baekjoonSelectors";

/**
 * Past Baekjoon submissions, driven from the service worker. Baekjoon returns
 * an empty body to script requests, so each listing page and each source page
 * is a real page load in one inactive tab the extension owns. Loads are spaced
 * out (BAEKJOON_PAGE_DELAY_MS, BAEKJOON_SOURCE_DELAY_MS) so a collection never
 * puts more load on the site than a person paging through their own list.
 */
export const BAEKJOON_PAGE_DELAY_MS = 3_000;
export const BAEKJOON_SOURCE_DELAY_MS = 3_000;
export const BAEKJOON_SOURCE_JITTER_MS = 2_000;
/** 250 pages of 20 rows: the history page imports at most 5,000 submissions at once. */
export const BAEKJOON_MAX_PAGES = 250;

export type BaekjoonTabResult<T> = { ok: true; value: T } | { ok: false; reason: "OPEN_FAILED" | "LOAD_FAILED" | "NO_RECEIVER" };
export type BaekjoonHistoryDeps = {
  /** Opens or reuses the owned inactive tab at url and resolves once that exact page has loaded. */
  load(url: string): Promise<BaekjoonTabResult<number>>;
  /** Sends one message to the owned tab's content script. */
  ask(tabId: number, message: object): Promise<BaekjoonTabResult<unknown>>;
  close(): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
  /** Builds, verifies and registers one capture; the caller owns server and account checks. */
  store(candidate: BaekjoonHistoryCandidate, sourceCode: string, username: string): Promise<{ ok: true; created: boolean } | { ok: false }>;
};

type ScanProgress = { phase: "pages"; stage: "reading-pages" | "waiting-pages"; rows: number; pagesLoaded: number; groupsExpanded: 0; groupsTotal: 0; lastProgressAt: number };
export type BaekjoonHistoryState =
  | { status: "IDLE" }
  | { status: "SCANNING"; progress: ScanProgress; startedAt: number }
  | { status: "READY"; candidates: BaekjoonHistoryCandidate[]; truncated?: boolean }
  | { status: "SCAN_INCOMPLETE"; failurePage: number }
  | { status: "TAB_NOT_FOUND"; sourceOpenFailure: string }
  | { status: "LOGIN_REQUIRED" | "INTERRUPTED" | "FAILED" | "BUSY" | "BAD_REQUEST" | "CANCELLING" };

export class BaekjoonHistoryTask {
  private state: BaekjoonHistoryState = { status: "IDLE" };
  private scanGeneration = 0;
  private username_: string | null = null;
  private candidates = new Map<string, BaekjoonHistoryCandidate>();
  private importer: HistoricalTaskController<BaekjoonHistoryCandidate> | null = null;

  constructor(private readonly deps: BaekjoonHistoryDeps) {}

  /** The signed-in id the current list was read for. */
  get username(): string | null { return this.username_; }

  get active(): boolean {
    return this.state.status === "SCANNING" || !!this.importer?.isActive;
  }

  status(): object {
    if (this.importer?.state) return { ...this.importer.state };
    return this.state.status === "IDLE" ? { status: "SCAN_IDLE" } : this.state;
  }

  /** Reads the signed-in id from the home page, then every page of the accepted list. */
  scan(): object {
    if (this.active) return { status: "BUSY" };
    this.importer = null;
    this.candidates.clear();
    const generation = ++this.scanGeneration, startedAt = this.deps.now();
    const progress: ScanProgress = { phase: "pages", stage: "reading-pages", rows: 0, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0, lastProgressAt: startedAt };
    this.state = { status: "SCANNING", progress, startedAt };
    const current = () => generation === this.scanGeneration && this.state.status === "SCANNING";
    void (async () => {
      const home = await this.deps.load(`${BAEKJOON_ORIGIN}/`);
      if (!current()) return;
      if (!home.ok) return this.finish({ status: "TAB_NOT_FOUND", sourceOpenFailure: home.reason === "OPEN_FAILED" ? "WINDOW" : "HOME_LOAD" });
      const identity = await this.deps.ask(home.value, { type: "BAEKJOON_IDENTITY" });
      if (!current()) return;
      const username = identity.ok ? (identity.value as { username?: unknown } | null)?.username : undefined;
      if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,40}$/.test(username)) return this.finish({ status: "LOGIN_REQUIRED" });
      this.username_ = username;
      const found: BaekjoonHistoryCandidate[] = [];
      let url: string | null = baekjoonListingUrl(username);
      for (let page = 1; url; page += 1) {
        if (page > BAEKJOON_MAX_PAGES) return this.finish({ status: "READY", candidates: found, truncated: true });
        if (page > 1) {
          this.state = { status: "SCANNING", progress: { ...progress, stage: "waiting-pages", rows: found.length, pagesLoaded: page - 1, lastProgressAt: this.deps.now() }, startedAt };
          await this.deps.sleep(BAEKJOON_PAGE_DELAY_MS);
          if (!current()) return;
        }
        const loaded = await this.deps.load(url);
        if (!current()) return;
        if (!loaded.ok) return this.finish({ status: "SCAN_INCOMPLETE", failurePage: page });
        const read = await this.deps.ask(loaded.value, { type: "BAEKJOON_LISTING_READ", url });
        if (!current()) return;
        const value = read.ok ? read.value as { status?: unknown; username?: unknown; candidates?: unknown; nextUrl?: unknown } | null : null;
        if (value?.status === "LOGIN_REQUIRED" || value?.status === "NOT_OWNER") return this.finish({ status: "LOGIN_REQUIRED" });
        if (value?.status !== "READY" || value.username !== username || !Array.isArray(value.candidates) || !value.candidates.every(isBaekjoonHistoryCandidate) ||
            (value.nextUrl !== null && typeof value.nextUrl !== "string")) return this.finish({ status: "SCAN_INCOMPLETE", failurePage: page });
        for (const candidate of value.candidates as BaekjoonHistoryCandidate[]) {
          if (!this.candidates.has(candidate.submissionId)) { this.candidates.set(candidate.submissionId, candidate); found.push(candidate); }
        }
        this.state = { status: "SCANNING", progress: { ...progress, stage: "reading-pages", rows: found.length, pagesLoaded: page, lastProgressAt: this.deps.now() }, startedAt };
        url = value.nextUrl as string | null;
      }
      this.finish({ status: "READY", candidates: found });
    })().catch(() => { if (current()) this.finish({ status: "FAILED" }); });
    return this.state;
  }

  /** Opens each selected source page in turn, spaced out, and stores what it verifies. */
  import(submissionIds: string[]): object {
    if (this.active) return { status: "BUSY" };
    if (this.state.status !== "READY" || !this.username_) return { status: "INTERRUPTED" };
    const selected = submissionIds.map(id => this.candidates.get(id));
    if (!selected.length || selected.some(candidate => !candidate)) return { status: "BAD_REQUEST" };
    const username = this.username_;
    const controller = new HistoricalTaskController<BaekjoonHistoryCandidate>(this.deps.now);
    this.importer = controller;
    let first = true;
    controller.start(selected as BaekjoonHistoryCandidate[], async (candidate, mayStore): Promise<HistoricalImportResult> => {
      if (!first) await this.deps.sleep(BAEKJOON_SOURCE_DELAY_MS + Math.floor(this.deps.random() * BAEKJOON_SOURCE_JITTER_MS));
      first = false;
      if (!mayStore()) return { saved: 0, duplicate: 0, skipped: 0 };
      const loaded = await this.deps.load(`${BAEKJOON_ORIGIN}/source/${candidate.submissionId}`);
      if (!loaded.ok) return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
      const read = await this.deps.ask(loaded.value, { type: "BAEKJOON_SOURCE_READ", username, candidate });
      const value = read.ok ? read.value as { status?: unknown; sourceCode?: unknown } | null : null;
      if (value?.status !== "DONE" || typeof value.sourceCode !== "string" || !mayStore()) {
        return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
      }
      const stored = await this.deps.store(candidate, value.sourceCode, username);
      if (!stored.ok) return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
      return stored.created ? { saved: 1, duplicate: 0, skipped: 0 } : { saved: 0, duplicate: 1, skipped: 0 };
    }, undefined, candidate => candidate.submissionId);
    void controller.settled().then(() => this.deps.close()).catch(() => undefined);
    return { ...controller.state! };
  }

  cancel(): object {
    if (this.state.status === "SCANNING") {
      this.scanGeneration += 1;
      this.finish({ status: "INTERRUPTED" });
    } else this.importer?.cancel();
    return this.status();
  }

  private finish(state: BaekjoonHistoryState): void {
    this.state = state;
    // The owned tab is kept only while a READY list waits for its import.
    if (state.status !== "READY") void this.deps.close().catch(() => undefined);
  }
}
