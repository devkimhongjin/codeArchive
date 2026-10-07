import type { Capture } from './types';
import type { GithubCommitStatus } from './relay';
import { canonicalLanguageDisplayName } from '../../../shared/language';
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from './capturePresentation';
import { buildLabel, updatedLabel } from '../../../shared/buildMetadata';
type Preview = Omit<Capture, 'sourceCode'> & { githubCommitStatus?: GithubCommitStatus };
interface PopupServices {
  load: () => Promise<unknown>;
  subscribeProgress?: (refresh: () => void) => void;
  openDashboard?: (view: 'github') => void;
  copy: (text: string) => Promise<void>;
  copyCapture?: (captureId: string) => Promise<{ ok?: boolean; text?: string }>;
  downloadCapture?: (captureId: string) => Promise<{ ok?: boolean }>;
  loadGithubStatuses?: (captureIds: string[]) => Promise<{ statuses?: Record<string, GithubCommitStatus> }>;
  updateSettings?: (patch: Record<string, boolean>) => Promise<unknown>;
  retryRelay?: () => Promise<unknown>;
}
function asSynced(value: unknown): value is Preview {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Capture>;
  return typeof item.captureId === 'string' && ['JUNGOL', 'SWEA', 'PROGRAMMERS'].includes(item.platform ?? '') &&
    typeof item.problemNumber === 'string' && typeof item.title === 'string' && typeof item.language === 'string' &&
    item.result === 'ACCEPTED' && item.syncState === 'SYNCED' && typeof item.observedAt === 'string' && !Number.isNaN(Date.parse(item.observedAt));
}
function renderRecent(document: Document, list: HTMLElement, empty: HTMLElement, captures: Preview[]) {
  list.replaceChildren(); empty.hidden = captures.length !== 0;
  for (const capture of captures) {
    const item = document.createElement('article'); item.className = 'recent-item';
    const heading = document.createElement('div'); heading.className = 'recent-item-heading';
    const platform = document.createElement('span'); platform.className = 'platform-label'; platform.textContent = capture.platform;
    const sync = document.createElement('span'); sync.className = 'sync-label'; sync.textContent = '동기화됨'; heading.append(platform, sync);
    const commit = capture.githubCommitStatus;
    if (commit && ['NOT_REQUESTED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(commit)) {
      const github = document.createElement('span'); github.className = `github-label github-${commit.toLowerCase()}`;
      github.textContent = commit === 'SUCCEEDED' ? 'GitHub 완료' : commit === 'PENDING' ? '커밋 대기' : commit === 'RUNNING' ? '커밋 중' : commit === 'FAILED' ? '커밋 실패' : commit === 'UNKNOWN' ? '커밋 확인 필요' : '자동 커밋 안 함'; heading.append(github);
    }
    const title = document.createElement('a'); title.className = 'recent-title'; title.href = 'dashboard.html'; title.target = '_blank'; title.rel = 'noopener noreferrer'; title.textContent = `#${capture.problemNumber} · ${capture.title}`;
    const meta = document.createElement('p'); meta.className = 'recent-meta'; meta.textContent = `${canonicalLanguageDisplayName(capture.language)} · 풀이 시간 ${formatSolutionTime(capture.solvedAt ?? capture.observedAt)}`;
    const performance = document.createElement('p'); performance.className = 'recent-performance'; performance.textContent = `실행 시간 ${formatExecutionTime(capture.executionTime)} · 메모리 ${formatCaptureMemory(capture)}`;
    item.append(heading, title, meta, performance); list.append(item);
  }
}
export function mountPopup(document: Document, services: PopupServices): void {
  const build = document.querySelector<HTMLElement>('#build-label'); if (build) build.textContent = buildLabel();
  const updated = document.querySelector<HTMLElement>('#updated-label'); if (updated) updated.textContent = updatedLabel();
  const error = document.querySelector<HTMLElement>('#error')!;
  const recentCard = document.querySelector<HTMLElement>('#recent-card')!;
  const recentCount = document.querySelector<HTMLElement>('#recent-count')!;
  const recentList = document.querySelector<HTMLElement>('#recent-list')!;
  const recentEmpty = document.querySelector<HTMLElement>('#recent-empty')!;
  const recentError = document.querySelector<HTMLElement>('#recent-error')!;
  const githubAuto = document.querySelector<HTMLInputElement>('#github-auto')!;
  const automationStatus = document.querySelector<HTMLElement>('#automation-status')!;
  const retryRelay = document.querySelector<HTMLButtonElement>('#retry-relay')!;
  let loading = false, retrying = false, reloadPending = false, generation = 0;
  async function load(): Promise<void> {
    if (loading) { reloadPending = true; return; }
    loading = true; const currentGeneration = ++generation;
    error.hidden = true; recentError.hidden = true; recentCard.setAttribute('aria-busy', 'true');
    try {
      const state = await services.load() as { settings?: { githubAutoCommitEnabled?: boolean; relay?: { status?: string } }; recentCaptures?: unknown; error?: unknown } | null;
      if (!state?.settings || state.error) throw new Error('Invalid state');
      const seen = new Set<string>();
      const captures = (Array.isArray(state.recentCaptures) ? state.recentCaptures : []).filter(asSynced)
        .filter(capture => { const key = `${capture.platform}:${capture.problemNumber}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
      githubAuto.checked = state.settings.githubAutoCommitEnabled === true; githubAuto.setAttribute('aria-checked', String(githubAuto.checked));
      const relayStatus = state.settings.relay?.status;
      automationStatus.textContent = relayStatus === 'CONFIRMED' ? '자동 동기화 중' : relayStatus === 'OFFLINE' ? '오프라인' : relayStatus === 'RELAY_ERROR' ? '동기화 오류' : '대시보드 로그인 필요';
      retryRelay.hidden = !services.retryRelay || (relayStatus !== 'OFFLINE' && relayStatus !== 'RELAY_ERROR');
      recentCount.textContent = captures.length ? `${captures.length}문제` : '없음'; renderRecent(document, recentList, recentEmpty, captures);
      if (captures.length && services.loadGithubStatuses) void services.loadGithubStatuses(captures.map(capture => capture.captureId)).then(response => {
        if (currentGeneration !== generation || !response?.statuses) return;
        renderRecent(document, recentList, recentEmpty, captures.map(capture => ({ ...capture, githubCommitStatus: response.statuses![capture.captureId] ?? capture.githubCommitStatus })));
      }).catch(() => undefined);
    } catch {
      error.hidden = false; recentError.hidden = false; automationStatus.textContent = '확인 필요'; retryRelay.hidden = true;
      recentList.replaceChildren(); recentCount.textContent = '확인 실패'; recentEmpty.hidden = true;
    } finally {
      loading = false; recentCard.setAttribute('aria-busy', 'false');
      if (reloadPending) { reloadPending = false; queueMicrotask(() => void load()); }
    }
  }
  githubAuto.addEventListener('click', event => { event.preventDefault(); services.openDashboard?.('github'); });
  services.subscribeProgress?.(() => void load());
  retryRelay.addEventListener('click', () => {
    if (retrying || !services.retryRelay) return;
    retrying = true; retryRelay.disabled = true; retryRelay.textContent = '재시도 중…';
    void services.retryRelay().catch(() => undefined).then(() => load()).finally(() => { retrying = false; retryRelay.disabled = false; retryRelay.textContent = '연결 재시도'; });
  });
  void load();
}
