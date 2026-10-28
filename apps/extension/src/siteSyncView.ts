import type { Platform } from './types';
import type { CommitState, SiteSyncProblemState, SiteSyncRowKey, SiteSyncRowState, SiteSyncStatus } from './siteSync';

export type SyncOutcome = { ok: boolean; message: string };
/** One actionable item on a site's list: a single submission row, or a SWEA problem card. */
export type SiteSyncTarget = {
  id: string; anchor: HTMLElement; problemNumber: string;
  row?: SiteSyncRowKey;
  sync(): Promise<SyncOutcome>;
};
/** refine: optional async enrichment (e.g. exact times) of the given unregistered rows; true when any key changed. */
export type SiteSyncPage = { platform: Platform; targets(): SiteSyncTarget[]; refine?(submissionIds: string[]): Promise<boolean> };
export type Send = (message: unknown) => Promise<unknown>;

// Controls live in a shadow root: site parsers (including ours) read cell text,
// and the shadow tree adds none, while site styles cannot reach the buttons.
const STYLE = `.codearchive-sync{display:inline-flex;flex-wrap:wrap;align-items:center;gap:3px;margin-left:4px;vertical-align:middle;font:600 11px/1.2 system-ui,sans-serif;white-space:nowrap}
.codearchive-sync button{padding:1px 6px;border:1px solid #5b45d9;border-radius:999px;background:#fff;color:#4a35c4;font:inherit;cursor:pointer}
.codearchive-sync button:hover:not(:disabled){background:#efeafe}
.codearchive-sync button:disabled{border-color:#d6d2e0;color:#a8a3b5;cursor:default}
.codearchive-sync .codearchive-sync-state{color:#6f6a7d;font-weight:500}
.codearchive-sync .codearchive-sync-state[data-tone="ok"]{color:#18794e}
.codearchive-sync .codearchive-sync-state[data-tone="error"]{color:#c4321a}`;

const COMMIT_LABELS: Record<CommitState, string> = { NONE: '등록됨', PENDING: '커밋 중', RUNNING: '커밋 중', SUCCEEDED: '커밋 완료', FAILED: '커밋 실패', UNKNOWN: '확인 필요' };
const ERROR_LABELS: Record<string, string> = { LOGIN_REQUIRED: 'CodeArchive 로그인 필요', ACCOUNT_CHANGED: '로그인 계정 확인 필요',
  SERVER_UNAVAILABLE: '서버 연결 실패', GITHUB_NOT_CONFIGURED: 'GitHub 저장소 연결 필요', AMBIGUOUS: '같은 시각 풀이가 여러 개라 확인 필요',
  NOT_REGISTERED: '먼저 동기화해 주세요', COMMIT_REJECTED: '커밋할 수 없는 상태' };
export const siteSyncErrorLabel = (error: unknown) => typeof error === 'string' && ERROR_LABELS[error] ? ERROR_LABELS[error]! : '처리하지 못했습니다';
const committable = (state: CommitState) => state === 'NONE' || state === 'FAILED';

export function mountSiteSync(document: Document, page: SiteSyncPage, send: Send) {
  let rows = new Map<string, SiteSyncRowState>(), problems = new Map<string, SiteSyncProblemState>();
  let githubReady = false, statusError: string | null = null, loaded = false, busy = false, disposed = false;
  let knownIds = '', scanTimer: ReturnType<typeof setTimeout> | undefined;
  const messages = new Map<string, { text: string; tone: 'ok' | 'error' }>();

  function view(target: SiteSyncTarget): { canSync: boolean; commitIds: string[]; text: string; tone?: 'ok' | 'error'; hint?: string } {
    const message = messages.get(target.id);
    if (!loaded) return { canSync: false, commitIds: [], text: '확인 중' };
    if (statusError) return { canSync: false, commitIds: [], text: siteSyncErrorLabel(statusError), tone: 'error' };
    if (target.row) {
      const state = rows.get(target.row.submissionId);
      if (!state || state.state === 'AMBIGUOUS') return { canSync: false, commitIds: [], text: message?.text ?? '확인 필요', tone: message?.tone ?? 'error' };
      if (state.state === 'UNREGISTERED') return { canSync: true, commitIds: [], text: message?.text ?? '미등록', tone: message?.tone };
      return { canSync: false, commitIds: githubReady && committable(state.commit) ? [state.captureId] : [], text: message?.text ?? COMMIT_LABELS[state.commit],
        tone: message?.tone ?? (state.commit === 'SUCCEEDED' ? 'ok' : state.commit === 'FAILED' || state.commit === 'UNKNOWN' ? 'error' : undefined) };
    }
    // A problem card does not say how many accepted submissions the site holds, so the
    // server's count cannot show that everything is registered. Sync stays available and
    // the wording says what the number means and what pressing sync does.
    const problem = problems.get(target.problemNumber);
    const uncommitted = problem?.uncommitted ?? [];
    const registered = problem?.registered ?? 0;
    return { canSync: true, commitIds: githubReady ? uncommitted.slice(0, 50) : [],
      text: message?.text ?? (registered ? `서버 ${registered}건 등록${uncommitted.length ? ` · ${uncommitted.length}건 커밋 전` : ''} · 추가분은 동기화로 확인` : '서버에 없음 · 동기화로 등록'),
      tone: message?.tone,
      hint: registered
        ? `서버에 이 문제의 정답 제출 ${registered}건이 등록돼 있습니다. 사이트에 서버에 없는 정답 제출이 더 있는지는 동기화를 눌러야 확인할 수 있습니다.`
        : '서버에 이 문제의 정답 제출이 없습니다. 동기화를 누르면 사이트의 정답 제출을 읽어 등록합니다.' };
  }

  function render(target: SiteSyncTarget) {
    let host = [...target.anchor.children].find((child): child is HTMLElement =>
      child.classList.contains('codearchive-sync-host') && (child as HTMLElement).dataset.codearchiveSyncId === target.id) ?? null;
    let box = host?.shadowRoot?.querySelector<HTMLElement>('.codearchive-sync') ?? null;
    if (!host || !box) {
      host?.remove();
      host = document.createElement('span'); host.className = 'codearchive-sync-host'; host.dataset.codearchiveSyncId = target.id;
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = STYLE;
      box = document.createElement('span'); box.className = 'codearchive-sync';
      const sync = document.createElement('button'); sync.type = 'button'; sync.dataset.action = 'sync'; sync.textContent = '동기화';
      const commit = document.createElement('button'); commit.type = 'button'; commit.dataset.action = 'commit'; commit.textContent = '커밋';
      const state = document.createElement('span'); state.className = 'codearchive-sync-state'; state.setAttribute('role', 'status');
      box.append(sync, commit, state);
      // Site rows open details on click; keep our controls from triggering them.
      box.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const action = (event.target as Element | null)?.closest?.('button')?.dataset.action;
        if (action === 'sync') void runSync(target.id); else if (action === 'commit') void runCommit(target.id);
      });
      root.append(style, box);
      target.anchor.append(host);
    }
    const current = view(target);
    const [sync, commit] = [...box.querySelectorAll<HTMLButtonElement>('button')];
    sync!.disabled = busy || !current.canSync; commit!.disabled = busy || current.commitIds.length === 0;
    sync!.title = sync!.disabled ? '' : target.row ? 'CodeArchive 서버에 이 풀이를 등록합니다' : '이 문제의 사이트 정답 제출을 읽어, 서버에 없는 것만 등록합니다';
    commit!.title = commit!.disabled ? '' : '연결된 GitHub 저장소에 커밋합니다';
    const state = box.querySelector<HTMLElement>('.codearchive-sync-state')!;
    state.textContent = current.text;
    state.title = current.hint && !messages.has(target.id) ? current.hint : '';
    if (current.tone) state.dataset.tone = current.tone; else delete state.dataset.tone;
  }

  const current = () => page.targets();
  function renderAll() { if (!disposed) for (const target of current()) render(target); }

  // Show the server state at once; then refine only unregistered rows (e.g.
  // read exact times to match live captures) and ask again if a key changed.
  async function refresh() {
    await readStatus();
    if (disposed || !page.refine || statusError) return;
    const unregistered = [...rows.values()].filter(row => row.state === 'UNREGISTERED').map(row => row.submissionId);
    let changed = false;
    try { changed = unregistered.length > 0 && await page.refine(unregistered); } catch { /* Keep the first answer. */ }
    if (changed && !disposed) await readStatus();
  }

  async function readStatus() {
    const targets = current();
    const keys = targets.flatMap(target => target.row ? [target.row] : []);
    const problemNumbers = targets.filter(target => !target.row).map(target => target.problemNumber);
    if (!keys.length && !problemNumbers.length) { loaded = true; return; }
    let status: SiteSyncStatus | undefined;
    try { status = await send({ type: 'SITE_SYNC_STATUS', rows: keys.slice(0, 500), problemNumbers: [...new Set(problemNumbers)].slice(0, 500) }) as SiteSyncStatus; }
    catch { status = { ok: false, error: 'SERVER_UNAVAILABLE' }; }
    if (disposed) return;
    loaded = true;
    if (!status?.ok) { statusError = status && 'error' in status ? status.error : 'SERVER_UNAVAILABLE'; renderAll(); return; }
    statusError = null; githubReady = status.githubReady;
    rows = new Map(status.rows.map(row => [row.submissionId, row])); problems = new Map(status.problems.map(problem => [problem.problemNumber, problem]));
    renderAll();
  }

  async function exclusive(id: string, work: () => Promise<SyncOutcome>) {
    if (busy) return;
    busy = true; messages.delete(id); renderAll();
    let outcome: SyncOutcome;
    try { outcome = await work(); } catch { outcome = { ok: false, message: '처리하지 못했습니다' }; }
    messages.set(id, { text: outcome.message, tone: outcome.ok ? 'ok' : 'error' });
    busy = false;
    await refresh();
  }
  async function runSync(id: string) {
    const target = current().find(item => item.id === id);
    if (target) await exclusive(id, () => target.sync());
  }
  async function runCommit(id: string) {
    const target = current().find(item => item.id === id);
    if (!target) return;
    const ids = view(target).commitIds;
    if (!ids.length) return;
    await exclusive(id, async () => {
      const result = await send({ type: 'SITE_SYNC_COMMIT', captureIds: ids }) as { ok?: boolean; error?: string } | undefined;
      return result?.ok ? { ok: true, message: ids.length > 1 ? `${ids.length}건 커밋 요청` : '커밋 요청됨' } : { ok: false, message: siteSyncErrorLabel(result?.error) };
    });
  }

  // Lists render late and change with paging or expanded groups. Re-render on
  // every change; fetch status again only when a new target appears.
  function scan() {
    if (disposed) return;
    const ids = current().map(target => target.id).sort().join('\n');
    renderAll();
    if (ids !== knownIds) { knownIds = ids; if (!busy) void refresh(); }
  }
  const observer = new (document.defaultView?.MutationObserver ?? MutationObserver)(mutations => {
    if (mutations.every(mutation => [...mutation.addedNodes, ...mutation.removedNodes].every(node => (node as Element).classList?.contains('codearchive-sync-host')))) return;
    clearTimeout(scanTimer); scanTimer = setTimeout(scan, 400);
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  // A submission made in another window is registered while this list stays
  // open; read the server state again when the user comes back to it.
  const win = document.defaultView;
  let lastFocusRefresh = 0;
  const onReturn = () => {
    if (disposed || busy || document.visibilityState === 'hidden' || Date.now() - lastFocusRefresh < 3_000) return;
    lastFocusRefresh = Date.now(); void refresh();
  };
  document.addEventListener('visibilitychange', onReturn);
  win?.addEventListener('focus', onReturn);
  scan();
  return {
    refresh,
    dispose() {
      disposed = true; observer.disconnect(); clearTimeout(scanTimer);
      document.removeEventListener('visibilitychange', onReturn); win?.removeEventListener('focus', onReturn);
      document.querySelectorAll('.codearchive-sync-host').forEach(node => node.remove());
    }
  };
}
