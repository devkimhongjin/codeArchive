import type { Capture } from './types';
import type { GithubCommitStatus } from './relay';
import { canonicalLanguageDisplayName } from '../../../shared/language';
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from './capturePresentation';
import { buildLabel, updatedLabel } from '../../../shared/buildMetadata';
import type { GithubToggleRequest, GithubToggleResult } from './popupGithubAutomation';
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
  updateGithubAutomation?: (request: GithubToggleRequest) => Promise<GithubToggleResult>;
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
  let loading = false, retrying = false, reloadPending = false, githubBusy = false;
  let localReady = false;
  let githubState: { githubAutoCommitEnabled?: boolean; githubTargetConfigured?: boolean; accountId?: string; accountSettingsVersion?: number } | undefined;
  let toggleNotice = '';
  let statusAccount: string | undefined;
  let knownStatuses = new Map<string, GithubCommitStatus>();
  let recentRenderKey: string | undefined;
  let visibleCaptures: Preview[] = [];
  let statusContext = '', statusEpoch = 0, statusInFlight = false, statusRefreshPending = false;
  const showRecent = (captures: Preview[]) => {
    const key = JSON.stringify(captures);
    if (key === recentRenderKey) return;
    recentRenderKey = key;
    renderRecent(document, recentList, recentEmpty, captures);
  };
  const showCurrentRecent = () => showRecent(visibleCaptures.map(capture => ({ ...capture, githubCommitStatus: knownStatuses.get(capture.captureId) })));
  async function refreshStatuses(): Promise<void> {
    if (!services.loadGithubStatuses || !visibleCaptures.length || !localReady || githubBusy) return;
    if (statusInFlight) { statusRefreshPending = true; return; }
    const epoch = statusEpoch, ids = visibleCaptures.map(capture => capture.captureId);
    statusInFlight = true;
    try {
      const response = await services.loadGithubStatuses(ids);
      if (epoch !== statusEpoch || !response?.statuses) return;
      for (const id of ids) {
        const status = response.statuses[id];
        if (typeof status === 'string' && ['NOT_REQUESTED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(status)) knownStatuses.set(id, status);
      }
      showCurrentRecent();
    } catch { /* Missing remote evidence retains the last confirmed display. */ }
    finally {
      statusInFlight = false;
      if (statusRefreshPending) { statusRefreshPending = false; void refreshStatuses(); }
    }
  }
  async function load(): Promise<void> {
    if (githubBusy) { reloadPending = true; return; }
    if (loading) { reloadPending = true; return; }
    loading = true; localReady = false;
    error.hidden = true; recentError.hidden = true; recentCard.setAttribute('aria-busy', 'true');
    try {
      const state = await services.load() as { settings?: NonNullable<typeof githubState> & { relay?: { status?: string } }; recentCaptures?: unknown; error?: unknown } | null;
      if (!state?.settings || state.error) throw new Error('Invalid state');
      if (statusAccount !== state.settings.accountId) {
        knownStatuses.clear(); statusAccount = state.settings.accountId;
      }
      const seen = new Set<string>();
      const captures = (Array.isArray(state.recentCaptures) ? state.recentCaptures : []).filter(asSynced)
        .filter(capture => { const key = `${capture.platform}:${capture.problemNumber}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
      // A replacement submission must never inherit the previous problem's status.
      knownStatuses = new Map(captures.flatMap(capture => {
        const status = knownStatuses.get(capture.captureId) ?? capture.githubCommitStatus;
        return status ? [[capture.captureId, status] as const] : [];
      }));
      visibleCaptures = captures;
      const nextStatusContext = JSON.stringify([state.settings.accountId, state.settings.accountSettingsVersion, captures.map(capture => capture.captureId)]);
      if (nextStatusContext !== statusContext) { statusContext = nextStatusContext; statusEpoch++; }
      githubAuto.checked = state.settings.githubAutoCommitEnabled === true; githubAuto.setAttribute('aria-checked', String(githubAuto.checked));
      githubState = state.settings;
      localReady = true;
      githubAuto.disabled = false;
      const relayStatus = state.settings.relay?.status;
      automationStatus.textContent = relayStatus === 'CONFIRMED' ? '자동 동기화 중' : relayStatus === 'OFFLINE' ? '오프라인' : relayStatus === 'RELAY_ERROR' ? '동기화 오류' : '대시보드 로그인 필요';
      retryRelay.hidden = !services.retryRelay || (relayStatus !== 'OFFLINE' && relayStatus !== 'RELAY_ERROR');
      if (toggleNotice) { error.hidden = false; error.textContent = toggleNotice; }
      recentCount.textContent = captures.length ? `${captures.length}문제` : '없음'; showCurrentRecent();
      // Remote polling coalesces independently: local captures and controls stay responsive.
      void refreshStatuses();
    } catch {
      githubState = undefined; githubAuto.disabled = true;
      localReady = false;
      knownStatuses.clear(); statusAccount = undefined; recentRenderKey = undefined;
      visibleCaptures = []; statusEpoch++; statusContext = '';
      error.hidden = false; recentError.hidden = false; automationStatus.textContent = '확인 필요'; retryRelay.hidden = true;
      error.textContent = '동기화 상태를 불러오지 못했어요. 팝업을 다시 열어 주세요.';
      recentList.replaceChildren(); recentCount.textContent = '확인 실패'; recentEmpty.hidden = true;
    } finally {
      loading = false; recentCard.setAttribute('aria-busy', 'false');
      if (reloadPending) { reloadPending = false; queueMicrotask(() => void load()); }
    }
  }
  githubAuto.addEventListener('click', event => {
    event.preventDefault();
    if (githubBusy || !localReady || !githubState) return;
    if (!githubState.githubTargetConfigured || !githubState.accountId || !Number.isSafeInteger(githubState.accountSettingsVersion)) {
      services.openDashboard?.('github'); return;
    }
    if (!services.updateGithubAutomation) return;
    const command: GithubToggleRequest = { enabled: !githubState.githubAutoCommitEnabled,
      accountId: githubState.accountId, settingsVersion: githubState.accountSettingsVersion! };
    githubBusy = true; statusEpoch++; githubAuto.disabled = true; toggleNotice = ''; error.hidden = true;
    automationStatus.textContent = 'GitHub 설정 저장 중…';
    void services.updateGithubAutomation(command).then(result => {
      if (result.needsTarget) { services.openDashboard?.('github'); return; }
      if (!result.ok) toggleNotice = result.error === 'ACCOUNT_CHANGED' ? '계정이 변경됐어요. 대시보드에서 현재 계정을 확인해 주세요.' :
        result.error === 'SETTINGS_CHANGED' ? '설정이 변경됐어요. 대시보드에서 최신 설정을 확인해 주세요.' :
        result.error === 'SAVE_UNCONFIRMED' ? '저장 결과를 확인하지 못했어요. 다시 누르기 전에 대시보드에서 확인해 주세요.' :
        'GitHub 설정을 저장하지 못했어요. 대시보드에서 연결 상태를 확인해 주세요.';
      else if (!result.relayReady) toggleNotice = 'GitHub 설정은 저장됐어요. 대시보드를 열어 자동 동기화 연결을 갱신해 주세요.';
    }).catch(() => { toggleNotice = '저장 결과를 확인하지 못했어요. 다시 누르기 전에 대시보드에서 확인해 주세요.'; })
      .finally(() => { githubBusy = false; void load(); });
  });
  services.subscribeProgress?.(() => void load());
  retryRelay.addEventListener('click', () => {
    if (retrying || !services.retryRelay) return;
    retrying = true; retryRelay.disabled = true; retryRelay.textContent = '재시도 중…';
    void services.retryRelay().catch(() => undefined).then(() => load()).finally(() => { retrying = false; retryRelay.disabled = false; retryRelay.textContent = '연결 재시도'; });
  });
  void load();
}
