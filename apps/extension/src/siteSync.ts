import { canonicalLanguageKey } from '../../../shared/language';
import { cloudRequest, CloudRequestError } from './cloudClient';
import { isHistoricalSubmissionId } from './historicalIdentity';
import type { Capture, Platform } from './types';

/**
 * Manual sync and commit from a platform's own submission list. The server is
 * the source of truth: a row is registered only when the server holds the
 * same site submission, or exactly one live capture of the same problem and
 * language submitted within LIVE_MATCH_WINDOW_MS of it.
 */
export type CommitState = 'NONE' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type SiteSyncRowKey = { submissionId: string; problemNumber: string; language?: string; solvedAt?: string };
export type SiteSyncRowState =
  | { submissionId: string; state: 'UNREGISTERED' }
  | { submissionId: string; state: 'AMBIGUOUS' }
  | { submissionId: string; state: 'REGISTERED'; captureId: string; commit: CommitState };
export type SiteSyncProblemState = { problemNumber: string; registered: number; uncommitted: string[] };
export type SiteSyncStatus =
  | { ok: true; githubReady: boolean; rows: SiteSyncRowState[]; problems: SiteSyncProblemState[] }
  | { ok: false; error: SiteSyncError };
export type SiteSyncError = 'LOGIN_REQUIRED' | 'ACCOUNT_CHANGED' | 'SERVER_UNAVAILABLE' | 'BAD_REQUEST' | 'AMBIGUOUS' |
  'GITHUB_NOT_CONFIGURED' | 'NOT_REGISTERED' | 'COMMIT_REJECTED';
export type ServerSolution = { captureId: string; platform: Platform; historicalSubmissionId: string | null; problemNumber: string;
  language: string; solvedAt: string; state: CommitState };

export const LIVE_MATCH_WINDOW_MS = 2 * 60_000;
const COMMIT_STATES: CommitState[] = ['NONE', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS: Platform[] = ['SWEA', 'PROGRAMMERS', 'JUNGOL'];

export function validSiteSyncRow(platform: Platform, value: unknown): value is SiteSyncRowKey {
  if (!value || typeof value !== 'object') return false;
  const row = value as SiteSyncRowKey;
  return isHistoricalSubmissionId(platform, row.submissionId) && typeof row.problemNumber === 'string' && /^\d{1,40}$/.test(row.problemNumber) &&
    (row.language === undefined || typeof row.language === 'string' && row.language.length > 0 && row.language.length <= 100) &&
    (row.solvedAt === undefined || typeof row.solvedAt === 'string' && Number.isFinite(Date.parse(row.solvedAt)));
}

function validServerSolution(value: unknown): value is ServerSolution {
  if (!value || typeof value !== 'object') return false;
  const row = value as ServerSolution;
  return typeof row.captureId === 'string' && UUID.test(row.captureId) && PLATFORMS.includes(row.platform) &&
    (row.historicalSubmissionId === null || row.historicalSubmissionId === undefined || typeof row.historicalSubmissionId === 'string') &&
    typeof row.problemNumber === 'string' && typeof row.language === 'string' && typeof row.solvedAt === 'string' &&
    COMMIT_STATES.includes(row.state);
}

const sameLanguage = (left: string, right: string) => canonicalLanguageKey(left) === canonicalLanguageKey(right);

/** Live captures carry no site submission id; match them only by problem, language and a close submission time. */
export function liveMatches(platform: Platform, row: { problemNumber: string; language?: string; solvedAt?: string }, solutions: ServerSolution[]): ServerSolution[] {
  if (!row.language || !row.solvedAt) return [];
  const time = Date.parse(row.solvedAt);
  return solutions.filter(solution => solution.platform === platform && !solution.historicalSubmissionId &&
    solution.problemNumber === row.problemNumber && sameLanguage(solution.language, row.language!) &&
    Math.abs(Date.parse(solution.solvedAt) - time) <= LIVE_MATCH_WINDOW_MS);
}

/**
 * A live capture is one submission, so it belongs to the closest row within
 * the window; other close rows (several submissions made seconds apart) are
 * different submissions. A tie, or a row closest to several live captures,
 * cannot be decided.
 */
export function matchSiteRows(platform: Platform, rows: SiteSyncRowKey[], solutions: ServerSolution[]): SiteSyncRowState[] {
  const exactFor = (row: SiteSyncRowKey) => solutions.filter(solution => solution.platform === platform && solution.historicalSubmissionId === row.submissionId);
  const openByProblem = new Map<string, SiteSyncRowKey[]>();
  for (const row of rows) if (!exactFor(row).length) openByProblem.set(row.problemNumber, [...(openByProblem.get(row.problemNumber) ?? []), row]);
  const owned = new Map<SiteSyncRowKey, ServerSolution[]>(), undecided = new Set<SiteSyncRowKey>();
  for (const live of solutions) {
    if (live.platform !== platform || live.historicalSubmissionId) continue;
    const near = (openByProblem.get(live.problemNumber) ?? []).filter(row => liveMatches(platform, row, [live]).length === 1)
      .map(row => ({ row, distance: Math.abs(Date.parse(live.solvedAt) - Date.parse(row.solvedAt!)) })).sort((left, right) => left.distance - right.distance);
    if (!near.length) continue;
    if (near.length > 1 && near[0]!.distance === near[1]!.distance) { near.filter(item => item.distance === near[0]!.distance).forEach(item => undecided.add(item.row)); continue; }
    owned.set(near[0]!.row, [...(owned.get(near[0]!.row) ?? []), live]);
  }
  return rows.map(row => {
    const exact = exactFor(row), live = owned.get(row) ?? [];
    if (exact.length > 1 || (!exact.length && (undecided.has(row) || live.length > 1))) return { submissionId: row.submissionId, state: 'AMBIGUOUS' };
    const match = exact[0] ?? live[0];
    return match ? { submissionId: row.submissionId, state: 'REGISTERED', captureId: match.captureId, commit: match.state }
      : { submissionId: row.submissionId, state: 'UNREGISTERED' };
  });
}

export function problemStates(platform: Platform, problemNumbers: string[], solutions: ServerSolution[]): SiteSyncProblemState[] {
  return [...new Set(problemNumbers)].map(problemNumber => {
    const own = solutions.filter(solution => solution.platform === platform && solution.problemNumber === problemNumber);
    return { problemNumber, registered: own.length, uncommitted: own.filter(solution => solution.state === 'NONE' || solution.state === 'FAILED').map(solution => solution.captureId) };
  });
}

type Settings = { version?: unknown; githubInstallationId?: unknown; githubOwner?: unknown; githubRepository?: unknown; githubBranch?: unknown };
type Target = { settingsVersion: number; installationId: number; owner: string; repository: string; branch: string };
function githubTarget(settings: Settings | null): Target | null {
  if (!settings || !Number.isSafeInteger(settings.version) || !Number.isSafeInteger(settings.githubInstallationId) || (settings.githubInstallationId as number) <= 0) return null;
  const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : null;
  const owner = text(settings.githubOwner), repository = text(settings.githubRepository), branch = text(settings.githubBranch);
  return owner && repository && branch ? { settingsVersion: settings.version as number, installationId: settings.githubInstallationId as number, owner, repository, branch } : null;
}

export type SiteSyncDeps = { accountId: () => Promise<string | undefined>; fetcher?: typeof fetch };

export class SiteSyncService {
  constructor(private readonly deps: SiteSyncDeps) {}

  /** The extension's signed-in account must be the browser's API session. */
  private async account(): Promise<{ githubId: string } | SiteSyncError> {
    const accountId = await this.deps.accountId();
    if (!accountId) return 'LOGIN_REQUIRED';
    try {
      const user = await cloudRequest<{ id: number; githubId: string }>('/api/auth/me', undefined, undefined, this.deps.fetcher);
      if (!user || !Number.isSafeInteger(user.id) || typeof user.githubId !== 'string' || !/^\d{1,40}$/.test(user.githubId)) return 'SERVER_UNAVAILABLE';
      return String(user.id) === accountId ? { githubId: user.githubId } : 'ACCOUNT_CHANGED';
    } catch (error) { return error instanceof CloudRequestError && (error.status === 401 || error.status === 403) ? 'LOGIN_REQUIRED' : 'SERVER_UNAVAILABLE'; }
  }

  private async solutions(githubId: string): Promise<ServerSolution[]> {
    const rows = await cloudRequest<unknown>('/api/solutions/github-candidates', githubId, undefined, this.deps.fetcher);
    if (!Array.isArray(rows) || rows.some(row => !validServerSolution(row))) throw new Error('Invalid solution list');
    return rows as ServerSolution[];
  }

  async status(platform: Platform, rows: SiteSyncRowKey[], problemNumbers: string[] = []): Promise<SiteSyncStatus> {
    const account = await this.account();
    if (typeof account === 'string') return { ok: false, error: account };
    try {
      const [solutions, settings] = await Promise.all([this.solutions(account.githubId),
        cloudRequest<Settings>('/api/settings', account.githubId, undefined, this.deps.fetcher).catch(() => null)]);
      return { ok: true, githubReady: githubTarget(settings) !== null, rows: matchSiteRows(platform, rows, solutions), problems: problemStates(platform, problemNumbers, solutions) };
    } catch { return { ok: false, error: 'SERVER_UNAVAILABLE' }; }
  }

  /** Registers one verified site submission, or reports the server record it already matches. */
  async register(capture: Capture): Promise<{ ok: true; created: boolean; captureId: string } | { ok: false; error: SiteSyncError }> {
    if (capture.historicalImport !== true || !isHistoricalSubmissionId(capture.platform, capture.historicalSubmissionId)) return { ok: false, error: 'BAD_REQUEST' };
    const account = await this.account();
    if (typeof account === 'string') return { ok: false, error: account };
    try {
      const solutions = await this.solutions(account.githubId);
      const [state] = matchSiteRows(capture.platform, [{ submissionId: capture.historicalSubmissionId!, problemNumber: capture.problemNumber,
        language: capture.language, solvedAt: capture.solvedAt }], solutions);
      if (state!.state === 'AMBIGUOUS') return { ok: false, error: 'AMBIGUOUS' };
      if (state!.state === 'REGISTERED') return { ok: true, created: false, captureId: state!.captureId };
      const result = await cloudRequest<{ acceptedCaptureIds?: unknown }>('/api/solutions/bulk', account.githubId, { captures: [capture] }, this.deps.fetcher);
      if (!Array.isArray(result?.acceptedCaptureIds) || result.acceptedCaptureIds.length !== 1 || result.acceptedCaptureIds[0] !== capture.captureId)
        return { ok: false, error: 'SERVER_UNAVAILABLE' };
      return { ok: true, created: true, captureId: capture.captureId };
    } catch { return { ok: false, error: 'SERVER_UNAVAILABLE' }; }
  }

  /** Requests a GitHub commit for registered, uncommitted or failed solutions of this account. */
  async commit(platform: Platform, captureIds: string[]): Promise<{ ok: true; states: Record<string, CommitState> } | { ok: false; error: SiteSyncError }> {
    if (captureIds.length < 1 || captureIds.length > 50 || captureIds.some(id => !UUID.test(id)) || new Set(captureIds).size !== captureIds.length) return { ok: false, error: 'BAD_REQUEST' };
    const account = await this.account();
    if (typeof account === 'string') return { ok: false, error: account };
    try {
      const [solutions, settings] = await Promise.all([this.solutions(account.githubId), cloudRequest<Settings>('/api/settings', account.githubId, undefined, this.deps.fetcher)]);
      const target = githubTarget(settings);
      if (!target) return { ok: false, error: 'GITHUB_NOT_CONFIGURED' };
      const own = new Map(solutions.filter(solution => solution.platform === platform).map(solution => [solution.captureId, solution]));
      if (captureIds.some(id => !own.has(id))) return { ok: false, error: 'NOT_REGISTERED' };
      if (captureIds.some(id => !['NONE', 'FAILED'].includes(own.get(id)!.state))) return { ok: false, error: 'COMMIT_REJECTED' };
      const result = await cloudRequest<Record<string, unknown>>('/api/solutions/github-batch', account.githubId, { captureIds, ...target }, this.deps.fetcher);
      if (!result || captureIds.some(id => !COMMIT_STATES.includes(result[id] as CommitState))) return { ok: false, error: 'SERVER_UNAVAILABLE' };
      return { ok: true, states: Object.fromEntries(captureIds.map(id => [id, result[id] as CommitState])) };
    } catch (error) { return { ok: false, error: error instanceof CloudRequestError && error.status === 409 ? 'COMMIT_REJECTED' : 'SERVER_UNAVAILABLE' }; }
  }
}
