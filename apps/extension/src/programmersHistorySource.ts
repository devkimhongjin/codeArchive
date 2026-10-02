import { authenticatedProgrammersUserId, readProgrammersLessonHistory, selectedProgrammersHistoryEditorUri } from "./historicalProgrammers";

type NativeSubmission = { createdAt: string; language: string; score: number; perfectScore: number; code: string };
type PageSource = { account: string; lesson: string; page: number; rows: NativeSubmission[] };
type SourceWindow = Window & { XMLHttpRequest?: typeof XMLHttpRequest };

/** Observe the site's existing history GET only; never request history ourselves. */
export function installProgrammersHistorySource(document: Document, location: Location, window: SourceWindow) {
  const pages = new Map<string, PageSource>();
  let disposed = false;
  const endpoint = (value: string) => {
    try {
      const url = new URL(value, location.href);
      const lesson = location.pathname.match(/^\/learn\/courses\/30\/lessons\/(\d{1,40})$/)?.[1];
      const page = Number(url.searchParams.get("page"));
      if (location.origin !== "https://school.programmers.co.kr" || !lesson || url.origin !== "https://programmers.co.kr" ||
          url.pathname !== `/api/v1/school/open-challenge/lessons/${lesson}/submissions` ||
          url.searchParams.get("perPage") !== "10" || !Number.isSafeInteger(page) || page < 1 || page > 10_000) return null;
      const account = authenticatedProgrammersUserId(document, location);
      return account ? { account, lesson, page } : null;
    } catch { return null; }
  };
  const record = (url: string, payload: unknown, binding: NonNullable<ReturnType<typeof endpoint>>) => {
    const current = endpoint(url);
    if (disposed || !current || current.account !== binding.account || current.lesson !== binding.lesson || current.page !== binding.page ||
        !payload || typeof payload !== "object") return;
    const data = payload as Record<string, unknown>;
    if (data.page !== binding.page || data.perPage !== 10 || !Array.isArray(data.submissions) || data.submissions.length > 10) return;
    const rows: NativeSubmission[] = [];
    for (const value of data.submissions) {
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (typeof row.createdAt !== "string" || typeof row.language !== "string" || typeof row.score !== "number" ||
          typeof row.perfectScore !== "number" || typeof row.code !== "string" || row.code.length > 1_000_000) return;
      rows.push({ createdAt: row.createdAt, language: row.language, score: row.score, perfectScore: row.perfectScore, code: row.code });
    }
    pages.set(`${binding.lesson}:${binding.page}`, { ...binding, rows });
    // This cache belongs to one auxiliary document and is never persisted.
    while (pages.size > 100 || [...pages.values()].reduce((n, page) => n + page.rows.reduce((n, row) => n + row.code.length, 0), 0) > 8_000_000)
      pages.delete(pages.keys().next().value!);
  };
  const prototype = window.XMLHttpRequest?.prototype;
  const originalOpen = prototype?.open;
  const pending = new Map<XMLHttpRequest, () => void>();
  const observedOpen = function(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["open"]>) {
    const prior = pending.get(this);
    if (prior) { this.removeEventListener("load", prior); pending.delete(this); }
    const binding = String(args[0]).toUpperCase() === "GET" ? endpoint(String(args[1])) : null;
    if (binding) {
      const onLoad = () => {
        pending.delete(this);
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === "json") record(this.responseURL, this.response, binding);
          else if (!this.responseType || this.responseType === "text") {
            const text = this.responseText;
            if (text.length <= 12_000_000) record(this.responseURL, JSON.parse(text), binding);
          }
        } catch { /* A changed response contract is unavailable, never guessed. */ }
      };
      pending.set(this, onLoad);
      this.addEventListener("load", onLoad, { once: true });
    }
    return originalOpen!.apply(this, args);
  } as XMLHttpRequest["open"];
  if (prototype && originalOpen) prototype.open = observedOpen;
  return {
    read(uri: string): string | null {
      const state = readProgrammersLessonHistory(document, location);
      if (disposed || state.status !== "READY") return null;
      const selected = state.candidates.filter(row => selectedProgrammersHistoryEditorUri(row.row) === uri);
      const cached = pages.get(`${state.lessonId}:${state.page}`);
      if (selected.length !== 1 || !cached || cached.account !== state.accountId) return null;
      const target = selected[0]!;
      const rows = cached.rows.filter(row => row.createdAt === target.createdAt && row.language === target.language &&
        row.score === target.score && row.perfectScore === row.score);
      return rows.length === 1 && rows[0]!.code.trim() ? rows[0]!.code : null;
    },
    cleanup() {
      disposed = true; pages.clear();
      for (const [xhr, listener] of pending) xhr.removeEventListener("load", listener);
      pending.clear();
      if (prototype?.open === observedOpen) prototype.open = originalOpen!;
    }
  };
}
