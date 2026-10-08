import { sweaDifficulty } from './problemDifficulty';
import { canonicalLanguageKey } from "../../../shared/language";
import { createCapture } from "./capture";
import { sweaDisplayedCodeLength } from "./adapters/sweaPerformance";

const ORIGIN = "https://swexpertacademy.com";
const LIST_PATH = "/main/userpage/code/userSubmitProblem.do";
const HISTORY_PATH = "/main/code/problem/problemSubmitHistory.do";
const DETAIL_PATH = "/main/code/problem/problemSubmitDetail.do";
const ID = /^[A-Za-z0-9_-]{1,100}$/;
type FetchHtml = (url: string, init?: RequestInit) => Promise<Response>;

type SweaSolvingClub = { solveclubId: string; probBoxId: string; problemBoxTitle: string };
export interface SweaHistoryCandidate { submissionId: string; problemNumber: string; title: string; contestProbId: string; userProblem?: boolean; solvingClub?: SweaSolvingClub; language: string; solvedAt: string; codeByteLength: number; executionTime?: number; memoryValue?: number; }
export type SweaScanFailureReason = "LIST_PAGE_INCOMPLETE" | "HISTORY_RESPONSE_UNAVAILABLE" | "HISTORY_PAGE_INCOMPLETE" | "SUBMISSION_ID_UNAVAILABLE" | "HISTORY_PAGE_REPEATED";
export type SweaHistoryPreview = { status: "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED" | "SCAN_INCOMPLETE"; candidates: []; skipped: number; failureReason?: SweaScanFailureReason; failurePage?: number; failedProblemNumber?: string } | { status: "READY"; candidates: SweaHistoryCandidate[]; skipped: number; truncated: boolean };
type Identity = { userId: string; nickname: string };
type SweaProblem = { contestProbId: string; problemNumber: string; title: string; userProblem?: boolean; solvingClub?: SweaSolvingClub };
function historyPath(problem: SweaProblem): string { return problem.solvingClub ? "/main/talk/solvingClub/problemSubmitHistory.do" : problem.userProblem ? "/main/code/userProblem/userProblemSubmitHistory.do" : HISTORY_PATH; }
function detailPath(problem: SweaProblem): string { return problem.solvingClub ? "/main/talk/solvingClub/problemSubmitDetail.do" : problem.userProblem ? "/main/code/userProblem/userProblemSubmitDetail.do" : DETAIL_PATH; }
function problemFormId(problem: SweaProblem): string { return !problem.solvingClub && problem.userProblem ? "contestProbForm" : "problemForm"; }
function sameProblemContext(document: Document, problem: SweaProblem): boolean {
  const form = document.querySelector(`#${problemFormId(problem)}`);
  return form?.querySelector<HTMLInputElement>('input[name="contestProbId"]')?.value === problem.contestProbId && (!problem.solvingClub ||
    (form.querySelector<HTMLInputElement>('input[name="solveclubId"]')?.value === problem.solvingClub.solveclubId &&
     form.querySelector<HTMLInputElement>('input[name="probBoxId"]')?.value === problem.solvingClub.probBoxId));
}

function parser(html: string): Document {
  // HTML parsing normalizes CRLF and discards a textarea's initial LF. Preserve
  // literal source newlines before parsing, so byte-length verification compares
  // the original response rather than a browser-normalized copy.
  let marker = "CODEARCHIVE_SOURCE_NEWLINE_";
  while (html.includes(marker)) marker += "_";
  const preserved = html.replace(/(<(textarea|pre)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_match, open: string, _tag: string, value: string, close: string) => `${open}${value.replace(/\r/g, `${marker}CR`).replace(/\n/g, `${marker}LF`)}${close}`);
  const document = new DOMParser().parseFromString(preserved, "text/html");
  for (const node of document.querySelectorAll<HTMLElement>("textarea,pre")) {
    const original = node.tagName === "TEXTAREA" ? (node as HTMLTextAreaElement).value : node.textContent ?? "";
    const restored = original.split(`${marker}CR`).join("\r").split(`${marker}LF`).join("\n");
    if (node.tagName === "TEXTAREA") (node as HTMLTextAreaElement).value = restored;
    else node.textContent = restored;
  }
  return document;
}
function text(el: Element | null): string { return el?.textContent?.replace(/\s+/g, " ").trim() ?? ""; }
function exactCount(value: string, pattern: RegExp): number | null { const match = value.match(pattern); const count = match?.[1] ? Number(match[1]) : NaN; return Number.isSafeInteger(count) && count >= 0 ? count : null; }
function ownIdentity(document: Document, location: Location): Identity | null {
  if (location.origin !== ORIGIN || location.pathname !== LIST_PATH) return null;
  const userId = document.querySelector<HTMLInputElement>('#searchForm input[name="userId"]')?.value ?? "";
  const solvingId = document.querySelector<HTMLInputElement>('#solvingForm input[name="userId"]')?.value ?? "";
  const nickname = text(document.querySelector(".my-login .name.hidden-sm-down"));
  const profile = text(document.querySelector(".mypage_wrap .my_label .nick"));
  return ID.test(userId) && solvingId === userId && nickname && nickname === profile ? { userId, nickname } : null;
}
function sameSignedInIdentity(document: Document, identity: Identity): boolean { return text(document.querySelector(".my-login .name.hidden-sm-down")) === identity.nickname; }
export function authenticatedSweaHistoryIdentity(document: Document, location: Location): { userId: string; nickname: string } | null { return ownIdentity(document, location); }
/** Compatibility helper retained for existing profile identity callers. */
export function authenticatedSweaUserId(profile: Document): string | null {
  const input = profile.querySelector<HTMLInputElement>('#searchForm input[name="userId"]')?.value;
  if (input && ID.test(input)) return input;
  const link = [...profile.querySelectorAll<HTMLAnchorElement>("a[href],a[onclick]")].find(a => text(a) === "Code");
  const action = link?.getAttribute("onclick") ?? link?.getAttribute("href") ?? "";
  return action.match(/(?:javascript:)?fnMoveToMenu\('CODE','([A-Za-z0-9_-]{1,100})'\)/)?.[1] ?? null;
}
function problemFromCard(card: HTMLElement): SweaProblem | null {
  const anchor = card.querySelector<HTMLAnchorElement>('a[onclick*="fn_move_prob"]');
  const action = anchor?.getAttribute("onclick") ?? "";
  const match = action.match(/^(?:javascript:)?fn_move_prob\('([A-Za-z0-9_-]{1,100})','([NY])','CODE','','\1',''\);?$/);
  const club = action.match(/^(?:javascript:)?fn_move_prob\('([A-Za-z0-9_-]{1,100})','([NY])','BOX','([A-Za-z0-9_-]{1,100})','([A-Za-z0-9_-]{1,100})','([^'\r\n]{0,300})'\);?$/);
  const header = card.querySelector(".widget-header-sub");
  const raw = text(header);
  const number = raw.match(/(?:^|\s)(\d{1,40})(?:\.|\s)/)?.[1];
  const title = text(anchor);
  const route = match ?? club;
  return route && number && title ? { contestProbId: route[1]!, problemNumber: number, title, ...(route[2] === "Y" ? { userProblem: true } : {}),
    ...(club ? { solvingClub: { solveclubId: club[3]!, probBoxId: club[4]!, problemBoxTitle: club[5]! } } : {}) } : null;
}

/** Only own My Page cards are problem traversal inputs, never submission records. */
export function previewSweaProblems(document: Document, location: Location): { identity: Identity; problems: SweaProblem[]; pages: number[]; total: number | null; pageIndex: number; rowNum: number } | null {
  const identity = ownIdentity(document, location); if (!identity) return null;
  const problems: SweaProblem[] = [];
  for (const card of document.querySelectorAll<HTMLElement>(".widget-list.solvingclub .widget-box-sub")) {
    const item = problemFromCard(card); if (item) problems.push(item);
  }
  const pages = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Page navigation"] a[href]')]
    .map(a => a.getAttribute("href")?.match(/pageIndex\.value=(\d{1,4})/)?.[1]).filter((v): v is string => !!v).map(Number)
    .filter(n => Number.isSafeInteger(n) && n > 0 && n <= 999);
  return { identity, problems, pages: [...new Set(pages)], total: exactCount(text(document.querySelector(".club_box_tit")), /제출한 Problem\((\d+)\)/),
    // The displayed active page is authoritative. A form field may retain the
    // next-search default until its pagination link is clicked.
    pageIndex: Number(text(document.querySelector('nav[aria-label="Page navigation"] .active')).match(/^\d+/)?.[0]) || Number(document.querySelector<HTMLInputElement>('#searchForm input[name="pageIndex"]')?.value) || 1,
    rowNum: Number(document.querySelector<HTMLInputElement | HTMLSelectElement>('#searchForm [name="rowNum"]')?.value) || 20 };
}
/** Legacy preview is intentionally problem-only; historical submission rows require the history transport. */
export function previewSweaHistory(document: Document, location: Location, authenticatedUserId: string | null = null) {
  if (!text(document.querySelector(".my-login .name.hidden-sm-down")))
    return { status: "LOGIN_REQUIRED" as const, candidates: [] as { problemNumber: string; title: string; contestProbId: string }[], skipped: 0 };
  const preview = previewSweaProblems(document, location);
  if (!preview) return { status: "OWNERSHIP_UNVERIFIED" as const, candidates: [] as { problemNumber: string; title: string; contestProbId: string }[], skipped: 0 };
  if (!authenticatedUserId || authenticatedUserId !== preview.identity.userId) return { status: "OWNERSHIP_UNVERIFIED" as const, candidates: [] as { problemNumber: string; title: string; contestProbId: string }[], skipped: 0 };
  return { status: "READY" as const, candidates: preview.problems, skipped: 0, truncated: preview.pages.length > 1 };
}

function historyForm(identity: Identity, problem: SweaProblem, contestHistoryId = "", pageIndex = 1): URLSearchParams {
  const form = new URLSearchParams({ contestProbId: problem.contestProbId, contestHistoryId, codeLangSet: "", sortType: "1", nickName: "", pageSize: "20", pageIndex: String(pageIndex) });
  if (problem.solvingClub) {
    // Club histories expose nickname search rather than the My checkbox. The
    // native owner ID of every returned row is still required before accepting it.
    form.set("nickName", identity.nickname);
    for (const [key, value] of Object.entries(problem.solvingClub)) form.set(key, value);
    form.set("problemBoxCnt", "0");
  } else { form.set("isChecked", "checked"); form.set("checkUserId", identity.userId); }
  return form;
}
function fetchHistoryDocument(fetchHtml: FetchHtml, identity: Identity, problem: SweaProblem, page = 1): Promise<Document | null> {
  const url = new URL(`${ORIGIN}${historyPath(problem)}`);
  const form = historyForm(identity, problem, "", page);
  // User Problem's observed contestProbForm submits with GET, unlike the
  // standard problemForm POST. Keep My submission filtering on every page.
  if (problem.userProblem && !problem.solvingClub) {
    form.set("sortType", "1");
    url.search = form.toString();
    return fetchDocument(fetchHtml, url.href, { credentials: "include" });
  }
  return fetchDocument(fetchHtml, url.href, { method: "POST", credentials: "include", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: form.toString() });
}
function metric(row: Element, label: string): string {
  for (const item of row.querySelectorAll(".info > ul > li")) {
    const spans = [...item.querySelectorAll("span")].map(text);
    if (spans.includes(label)) return spans.find(value => value !== label) ?? "";
  }
  return "";
}
function submissionIdFromRow(row: Element): string | undefined {
  const links = [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].map(link => link.getAttribute("href")?.match(/^javascript:(?:codeview|fnShowCodeView)\('([A-Za-z0-9_-]{8,160})'\);?$/)?.[1]).filter(Boolean);
  return links.length === 1 ? links[0] : undefined;
}
function rowCandidate(row: HTMLElement, problem: SweaProblem, identity: Identity): SweaHistoryCandidate | null {
  const linkedId = submissionIdFromRow(row);
  const fallbackId = "submissionId" in problem ? (problem as { submissionId?: unknown }).submissionId : undefined;
  const id = linkedId ?? (typeof fallbackId === "string" ? fallbackId : undefined);
  const ownerAction = row.querySelector(".submitter .smt_txt a[onclick]")?.getAttribute("onclick") ?? "";
  const owner = ownerAction.match(new RegExp(`^userInformationPopup\\('${identity.userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\'\\);?$`));
  const solved = text(row.querySelector(".submitter .smt_txt dd")).replace(/^제출일\s*:\s*/, "");
  const language = metric(row, "언어"); const memory = metric(row, "메모리"); const time = metric(row, "실행시간") || metric(row, "시간");
  const length = metric(row, "코드길이"); const result = metric(row, "결과");
  const parse = (value: string) => { const match = value.match(/\d[\d,]*(?:\.\d+)?/); return match ? Number(match[0].replace(/,/g, "")) : NaN; };
  const bytes = parse(length); const executionTime = parse(time); const memoryValue = parse(memory);
  if (!id || !owner || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(solved) || !canonicalLanguageKey(language) || result !== "Pass" ||
    !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 1_000_000) return null;
  return { submissionId: id, ...problem, language, solvedAt: `${solved}:00.000+09:00`, codeByteLength: bytes,
    ...(Number.isFinite(executionTime) ? { executionTime } : {}), ...(Number.isFinite(memoryValue) ? { memoryValue } : {}) };
}
function ownerIs(row: Element, identity: Identity): boolean {
  const action = row.querySelector(".submitter .smt_txt a[onclick]")?.getAttribute("onclick") ?? "";
  return action === `userInformationPopup('${identity.userId}')` || action === `userInformationPopup('${identity.userId}');`;
}
function problemTitle(document: Document): { problemNumber: string; title: string } | null {
  const nodes = document.querySelectorAll<HTMLElement>(".problem_title");
  const node = nodes.length === 1 ? nodes[0] : null;
  if (!node) return null;
  const clone = node.cloneNode(true) as HTMLElement; clone.querySelectorAll(".badge").forEach(item => item.remove());
  const raw = text(clone); const match = raw.match(/(?:^|\s)(\d{1,40})(?:\.|\s)+(.*)$/);
  return match?.[1] && match[2]?.trim() ? { problemNumber: match[1], title: match[2].trim() } : null;
}

function verifiedSourceCode(responseSource: string, bytes: number): string | null {
  const exact = (value: string) => sweaDisplayedCodeLength(value) === bytes;
  if (exact(responseSource)) return responseSource;
  const htmlSource = responseSource.replace(/\r\n?/g, "\n").replace(/^\n/, "");
  if (exact(htmlSource)) return htmlSource;
  // Some detail templates surround the submitted source with indentation.
  // Remove only boundary whitespace, never interior tabs/spaces/newlines. A
  // native byte count must select one unique result; ambiguous boundaries fail.
  const matches = new Set<string>();
  for (const value of new Set([responseSource, htmlSource])) {
    for (const start of [value, value.trimStart()]) {
      const endings = new Set([start, start.replace(/[ \t]+$/, ""), start.trimEnd()]);
      // A template newline may follow the source's own final newline(s).
      // Preserve every intermediate suffix instead of keeping all or none.
      // Only remove complete boundary line endings; never insert characters.
      let ending = start;
      for (let lines = 0; lines < 64; lines++) {
        const next = ending.replace(/(?:\r\n|\r|\n)[ \t]*$/, "");
        if (next === ending) break;
        endings.add(next);
        endings.add(next.replace(/[ \t]+$/, ""));
        ending = next;
      }
      for (const end of endings) {
        if (end.trim() && exact(end)) matches.add(end);
      }
    }
  }
  return matches.size === 1 ? [...matches][0]! : null;
}

async function fetchDocument(fetchHtml: FetchHtml, url: string, init?: RequestInit): Promise<Document | null> {
  const result = await fetchSweaDocument(fetchHtml, url, init);
  return result.status === "DONE" ? result.document : null;
}

type SweaDocumentResult = { status: "DONE"; document: Document } | { status: "TAB_NOT_FOUND" | "SOURCE_UNAVAILABLE" };
async function fetchSweaDocument(fetchHtml: FetchHtml, url: string, init?: RequestInit): Promise<SweaDocumentResult> {
  try {
    const response = await fetchHtml(url, init); const final = new URL(response.url); const requested = new URL(url);
    if (final.origin !== ORIGIN || final.pathname !== requested.pathname) return { status: "TAB_NOT_FOUND" };
    if (!response.ok) return { status: "SOURCE_UNAVAILABLE" };
    return { status: "DONE", document: parser(await response.text()) };
  } catch { return { status: "SOURCE_UNAVAILABLE" }; }
}

/** Follows only observed My Page pagination and fails closed if identity changes. */
export async function loadSweaHistoryPreview(document: Document, location: Location, fetchHtml: FetchHtml = fetch,
  onProgress: (value: { problems: number; pages: number; historiesRead?: number; historiesTotal?: number }) => void = () => undefined, isCurrent: () => boolean = () => true): Promise<SweaHistoryPreview> {
  const first = previewSweaProblems(document, location); if (!first) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
  const total = first.total;
  const incomplete = (failureReason: SweaScanFailureReason, failurePage: number, failedProblemNumber?: string): SweaHistoryPreview =>
    ({ status: "SCAN_INCOMPLETE", candidates: [], skipped: 0, failureReason, failurePage, ...(failedProblemNumber ? { failedProblemNumber } : {}) });
  if (total === null || total < first.problems.length) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
  const pagesTotal = Math.ceil(total / 20); const allProblems: SweaProblem[] = [];
  for (let page = 1; page <= pagesTotal; page++) {
    if (!isCurrent()) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
    const current = page === first.pageIndex && first.rowNum === 20 ? document : await (async () => {
    const url = new URL(`${ORIGIN}${LIST_PATH}`); url.searchParams.set("userId", first.identity.userId); url.searchParams.set("problemTitle", ""); url.searchParams.set("rowNum", "20"); url.searchParams.set("pageIndex", String(page));
      return fetchDocument(fetchHtml, url.href, { credentials: "include" });
    })();
    const preview = current && previewSweaProblems(current, location);
    if (!preview || preview.pageIndex !== page || preview.rowNum !== 20 || preview.total !== total || preview.identity.userId !== first.identity.userId || preview.identity.nickname !== first.identity.nickname || preview.problems.length !== Math.min(20, total - (page - 1) * 20)) return incomplete("LIST_PAGE_INCOMPLETE", page);
    allProblems.push(...preview.problems);
    onProgress({ problems: new Set(allProblems.map(problem => problem.problemNumber)).size, pages: page });
  }
  // The same public problem may appear once as CODE and again in a club. Both
  // histories must be read; only a repeated identical history scope is invalid.
  const scopes = allProblems.map(problem => JSON.stringify([problem.contestProbId, !!problem.userProblem, problem.solvingClub?.solveclubId, problem.solvingClub?.probBoxId]));
  if (allProblems.length !== total || new Set(scopes).size !== total) return { status: "SCAN_INCOMPLETE", candidates: [], skipped: 0 };
  const problemCount = new Set(allProblems.map(problem => problem.problemNumber)).size;
  const output: SweaHistoryCandidate[] = []; let skipped = 0; let pagesRead = pagesTotal; const seen = new Map<string, string>();
  for (const [problemIndex, problem] of allProblems.entries()) {
    if (!isCurrent()) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
    onProgress({ problems: problemCount, pages: pagesRead, historiesRead: problemIndex, historiesTotal: allProblems.length });
    const scopeSubmissionIds = new Set<string>();
    const history = await fetchHistoryDocument(fetchHtml, first.identity, problem);
    if (!history) return incomplete("HISTORY_RESPONSE_UNAVAILABLE", 1, problem.problemNumber);
    if (!sameSignedInIdentity(history, first.identity)) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
    if (!sameProblemContext(history, problem)) return incomplete("HISTORY_PAGE_INCOMPLETE", 1, problem.problemNumber);
    const historyTotal = exactCount(text(history.querySelector("h5.section_tit")), /총\s*(\d+)\s*회\s*제출/);
    if (historyTotal === null) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
    for (let page = 1; page <= Math.ceil(historyTotal / 20); page++) {
      const current = page === 1 ? history : await fetchHistoryDocument(fetchHtml, first.identity, problem, page);
      if (!current || !sameProblemContext(current, problem) || exactCount(text(current.querySelector("h5.section_tit")), /총\s*(\d+)\s*회\s*제출/) !== historyTotal) return incomplete("HISTORY_PAGE_INCOMPLETE", page, problem.problemNumber);
      if (!sameSignedInIdentity(current, first.identity)) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
      const rows = [...current.querySelectorAll<HTMLElement>(".box-list-inner .problem_smt")];
      if (rows.length !== Math.min(20, historyTotal - (page - 1) * 20)) return incomplete("HISTORY_PAGE_INCOMPLETE", page, problem.problemNumber);
      if (rows.some(row => !ownerIs(row, first.identity))) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
      for (const row of rows) {
        const rawId = submissionIdFromRow(row);
        if (!rawId) return incomplete("SUBMISSION_ID_UNAVAILABLE", page, problem.problemNumber);
        if (scopeSubmissionIds.has(rawId)) return incomplete("HISTORY_PAGE_REPEATED", page, problem.problemNumber);
        scopeSubmissionIds.add(rawId);
        const signature = JSON.stringify([problem.contestProbId, problem.problemNumber, problem.title, text(row.querySelector(".submitter .smt_txt dd")),
          ...["언어", "메모리", "코드길이", "결과"].map(label => metric(row, label)), metric(row, "실행시간") || metric(row, "시간")]);
        const previous = seen.get(rawId);
        if (previous !== undefined) {
          if (previous !== signature) return incomplete("HISTORY_PAGE_REPEATED", page, problem.problemNumber);
          continue;
        }
        seen.set(rawId, signature); const candidate = rowCandidate(row, problem, first.identity); if (!candidate) { skipped++; continue; } output.push(candidate);
      }
      pagesRead += 1;
      onProgress({ problems: problemCount, pages: pagesRead, historiesRead: problemIndex, historiesTotal: allProblems.length });
    }
    onProgress({ problems: problemCount, pages: pagesRead, historiesRead: problemIndex + 1, historiesTotal: allProblems.length });
  }
  return { status: "READY", candidates: output, skipped, truncated: false };
}

/** Fetches raw, unhighlighted detail HTML and verifies the selected row before local storage. */
export type SweaHydrationResult = { status: "DONE"; capture: ReturnType<typeof createCapture> } |
  { status: "OWNERSHIP_UNVERIFIED" | "TAB_NOT_FOUND" | "SOURCE_UNAVAILABLE"; verificationFailure?: "context" | "source" | "title" | "length" | "metadata" };
export async function hydrateSweaCandidateResult(candidate: SweaHistoryCandidate, identity: { userId: string; nickname: string }, fetchHtml: FetchHtml = fetch): Promise<SweaHydrationResult> {
  const fetched = await fetchSweaDocument(fetchHtml, `${ORIGIN}${detailPath(candidate)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: historyForm(identity, candidate, candidate.submissionId).toString() });
  if (fetched.status !== "DONE") return fetched;
  const detail = fetched.document;
  if (!sameSignedInIdentity(detail, identity)) return { status: "OWNERSHIP_UNVERIFIED" };
  if (!sameProblemContext(detail, candidate)) return { status: "SOURCE_UNAVAILABLE", verificationFailure: "context" };
  const row = detail.querySelector<HTMLElement>(".box-list-inner > .problem_smt_detail"); const sources = detail.querySelectorAll<HTMLElement>('textarea[class^="brush:"],pre[class^="brush:"]'); const source = sources.length === 1 ? sources[0] : null;
  const responseSource = source?.tagName === "TEXTAREA" ? (source as HTMLTextAreaElement).value : source?.textContent ?? "";
  const sourceCode = verifiedSourceCode(responseSource, candidate.codeByteLength);
  const title = problemTitle(detail);
  const clubTitles = detail.querySelectorAll(".problem_title");
  const clubTitle = clubTitles.length === 1 ? clubTitles[0]!.cloneNode(true) as HTMLElement : null;
  clubTitle?.querySelectorAll(".badge").forEach(item => item.remove());
  const matchesTitle = candidate.solvingClub ? text(clubTitle) === candidate.title : !!title && title.problemNumber === candidate.problemNumber && title.title === candidate.title;
  // SWEA renders Python submissions with its cpp brush. Highlighting is
  // presentation, not the submitted language; the native detail row below
  // must still exactly match the selected language and submission metadata.
  if (!row || !source) return { status: "SOURCE_UNAVAILABLE", verificationFailure: "source" };
  if (!matchesTitle) return { status: "SOURCE_UNAVAILABLE", verificationFailure: "title" };
  if (sourceCode === null) return { status: "SOURCE_UNAVAILABLE", verificationFailure: "length" };
  const again = rowCandidate(row, candidate, identity);
  if (!again || again.submissionId !== candidate.submissionId || again.solvedAt !== candidate.solvedAt || again.language !== candidate.language || again.codeByteLength !== candidate.codeByteLength) return { status: "SOURCE_UNAVAILABLE", verificationFailure: "metadata" };
  const problemUrl = new URL(candidate.solvingClub ? `${ORIGIN}/main/talk/solvingClub/problemView.do` : `${ORIGIN}/main/code/${candidate.userProblem ? "userProblem/userProblemDetail" : "problem/problemDetail"}.do`);
  problemUrl.searchParams.set("contestProbId", candidate.contestProbId);
  if (candidate.solvingClub) for (const [key, value] of Object.entries(candidate.solvingClub)) problemUrl.searchParams.set(key, value);
  const capture = createCapture({ difficulty: sweaDifficulty(detail, candidate.problemNumber, problemUrl.href), platform: "SWEA", problemNumber: candidate.problemNumber, title: candidate.title, problemUrl: problemUrl.href, language: candidate.language, sourceCode, result: "ACCEPTED", solvedAt: candidate.solvedAt, observedAt: new Date(), historicalImport: true, historicalSubmissionId: candidate.submissionId, ...(candidate.executionTime === undefined ? {} : { executionTime: candidate.executionTime }), ...(candidate.memoryValue === undefined ? {} : { memoryValue: candidate.memoryValue, memoryUnit: "KB" }) });
  return capture ? { status: "DONE", capture } : { status: "SOURCE_UNAVAILABLE" };
}

/** Compatibility helper for callers that only need an isolated detail outcome. */
export async function hydrateSweaCandidate(candidate: SweaHistoryCandidate, identity: { userId: string; nickname: string }, fetchHtml: FetchHtml = fetch) {
  const result = await hydrateSweaCandidateResult(candidate, identity, fetchHtml);
  return result.status === "DONE" ? result.capture : null;
}
