import type { Capture } from './types';
import type { GithubCommitStatus } from './relay';
import { canonicalLanguageDisplayName } from '../../../shared/language';
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from './capturePresentation';
import { buildLabel, updatedLabel } from '../../../shared/buildMetadata';
import type { GithubToggleRequest, GithubToggleResult } from './popupGithubAutomation';
import type { PopupBatchAction, PopupBatchProgress } from './popupBatchProgress';
type Preview = Omit<Capture, 'sourceCode'> & { githubCommitStatus?: GithubCommitStatus; githubUrl?: string };
interface PopupServices {
  load: () => Promise<unknown>;
  /** Local settings only: no server round trip, so the switch is not held behind a cold API. */
  loadLocal?: () => Promise<unknown>;
  loadBatchProgress?: () => Promise<{ progress?: PopupBatchProgress | null }>;
  batchAction?: (command: PopupBatchAction) => Promise<{ ok?: boolean; error?: string }>;
  subscribeProgress?: (refresh: () => void) => void;
  openDashboard?: (view: 'github') => void;
  copy: (text: string) => Promise<void>;
  copyCapture?: (captureId: string) => Promise<{ ok?: boolean; text?: string }>;
  downloadCapture?: (captureId: string) => Promise<{ ok?: boolean }>;
  loadGithubStatuses?: (captureIds: string[]) => Promise<{ statuses?: Record<string, GithubCommitStatus>; links?: Record<string, string> }>;
  updateSettings?: (patch: Record<string, boolean>) => Promise<unknown>;
  updateGithubAutomation?: (request: GithubToggleRequest) => Promise<GithubToggleResult>;
  retryRelay?: () => Promise<unknown>;
  syncPending?: () => Promise<unknown>;
}
/** Explains a manual sync in the user's terms, including why nothing was sent. */
export function pendingSyncMessage(response: unknown): string {
  const summary = (response as { ok?: boolean; summary?: { status?: string; sent?: number; rejected?: number; remaining?: number; error?: string; rejection?: string } } | null)?.summary;
  if (!summary) return '동기화를 시작하지 못했어요. 팝업을 다시 열어 주세요.';
  const sent = summary.sent ?? 0, rejected = summary.rejected ?? 0;
  const done = [sent ? `${sent}개 전송 완료` : '', rejected ? `${rejected}개는 서버가 받지 않아 남겨 두었어요${summary.rejection ? ` (사유: ${summary.rejection})` : ''}` : ''].filter(Boolean).join(' · ');
  const reason = summary.status === 'LOGIN_REQUIRED' ? '대시보드에서 다시 로그인해 주세요.'
    : summary.status === 'ACCOUNT_CHANGED' || summary.error === 'ACCOUNT_CHANGED' ? '로그인 계정이 바뀌었어요. 대시보드에서 계정을 확인해 주세요.'
    : summary.status === 'RECONNECT_REQUIRED' || summary.status === 'NO_ACCOUNT' ? '연결 정보를 확인하지 못했어요. 대시보드를 열면 연결이 갱신돼요.'
    : summary.status === 'OFFLINE' || summary.status === 'STOPPED' ? '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' : '';
  if (summary.status === 'IDLE') return '보낼 임시 저장이 없어요.';
  return [done, reason].filter(Boolean).join(' ') || '모두 전송했어요.';
}

function asSynced(value: unknown): value is Preview {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Capture>;
  return typeof item.captureId === 'string' && ['JUNGOL', 'SWEA', 'PROGRAMMERS'].includes(item.platform ?? '') &&
    typeof item.problemNumber === 'string' && typeof item.title === 'string' && typeof item.language === 'string' &&
    item.result === 'ACCEPTED' && item.syncState === 'SYNCED' && typeof item.observedAt === 'string' && !Number.isNaN(Date.parse(item.observedAt));
}
/** Opens the dashboard on this solution. */
function dashboardSolutionUrl(captureId: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(captureId) ? `dashboard.html?capture=${captureId}` : 'dashboard.html';
}
function githubFileUrl(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null; } catch { return null; }
}
function newTabLink(document: Document, className: string, href: string, text: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a'); link.className = className; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = text; link.setAttribute('aria-label', label); return link;
}
function renderRecent(document: Document, list: HTMLElement, empty: HTMLElement, captures: Preview[], services: PopupServices) {
  list.replaceChildren(); empty.hidden = captures.length !== 0;
  for (const capture of captures) {
    const item = document.createElement('article'); item.className = 'recent-item';
    const heading = document.createElement('div'); heading.className = 'recent-item-heading';
    const platform = document.createElement('span'); platform.className = 'platform-label'; platform.textContent = capture.platform;
    const dashboardUrl = dashboardSolutionUrl(capture.captureId);
    const sync = newTabLink(document, 'sync-label', dashboardUrl, '동기화됨', `#${capture.problemNumber} 대시보드에서 보기`); heading.append(platform, sync);
    const commit = capture.githubCommitStatus;
    if (commit && ['NOT_REQUESTED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(commit)) {
      const text = commit === 'SUCCEEDED' ? 'GitHub 완료' : commit === 'PENDING' ? '커밋 대기' : commit === 'RUNNING' ? '커밋 중' : commit === 'FAILED' ? '커밋 실패' : commit === 'UNKNOWN' ? '커밋 확인 필요' : '자동 커밋 안 함';
      const fileUrl = commit === 'SUCCEEDED' ? githubFileUrl(capture.githubUrl) : null;
      const github = fileUrl ? newTabLink(document, '', fileUrl, text, `#${capture.problemNumber} GitHub에서 보기`) : document.createElement('span');
      github.className = `github-label github-${commit.toLowerCase()}`; github.textContent = text; heading.append(github);
    }
    const title = document.createElement('a'); title.className = 'recent-title'; title.href = dashboardUrl; title.target = '_blank'; title.rel = 'noopener noreferrer'; title.textContent = `#${capture.problemNumber} · ${capture.title}`;
    const meta = document.createElement('p'); meta.className = 'recent-meta'; meta.textContent = `${canonicalLanguageDisplayName(capture.language)} · 풀이 시간 ${formatSolutionTime(capture.solvedAt ?? capture.observedAt)}`;
    const performance = document.createElement('p'); performance.className = 'recent-performance'; performance.textContent = `실행 시간 ${formatExecutionTime(capture.executionTime)} · 메모리 ${formatCaptureMemory(capture)}`;
    item.append(heading, title, meta, performance);
    const actions = document.createElement('div'); actions.className = 'recent-actions';
    const notice = document.createElement('span'); notice.setAttribute('role', 'status');
    for (const action of ['copy', 'download'] as const) {
      const handler = action === 'copy' ? services.copyCapture : services.downloadCapture;
      if (!handler) continue;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = action === 'copy' ? '코드 복사' : '다운로드';
      button.setAttribute('aria-label', `${capture.problemNumber} ${button.textContent}`);
      button.addEventListener('click', async () => {
        button.disabled = true; notice.textContent = '서버에서 코드를 가져오고 있어요.';
        try {
          if (action === 'copy') { const result = await services.copyCapture!(capture.captureId); if (!result.ok || typeof result.text !== 'string') throw new Error(); await services.copy(result.text); }
          else if (!(await services.downloadCapture!(capture.captureId)).ok) throw new Error();
          notice.textContent = action === 'copy' ? '복사했습니다.' : '다운로드를 시작했습니다.';
        } catch { notice.textContent = '코드를 가져오지 못했습니다. 로그인·연결 상태를 확인해 주세요.'; }
        finally { button.disabled = false; }
      });
      actions.append(button);
    }
    if (actions.childElementCount) { actions.append(notice); item.append(actions); }
    list.append(item);
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
  const pendingUploads = document.querySelector<HTMLElement>('#pending-uploads');
  const retryRelay = document.querySelector<HTMLButtonElement>('#retry-relay')!;
  const syncPending = document.querySelector<HTMLButtonElement>('#sync-pending');
  const syncPendingResult = document.querySelector<HTMLElement>('#sync-pending-result');
  let syncingPending = false;
  const githubAutoRow = githubAuto.closest<HTMLElement>('.switch-row');
  // Until settings are read the switch shows a checking state rather than a stale OFF or a disabled look.
  const setChecking = (checking: boolean) => {
    githubAutoRow?.classList.toggle('is-checking', checking);
    if (checking) githubAuto.setAttribute('aria-busy', 'true'); else githubAuto.removeAttribute('aria-busy');
  };
  setChecking(true); githubAuto.disabled = true;
  let loading = false, retrying = false, reloadPending = false, githubBusy = false;
  let localEpoch = 0;
  let localReady = false;
  let githubState: { githubAutoCommitEnabled?: boolean; githubTargetConfigured?: boolean; accountId?: string; accountSettingsVersion?: number } | undefined;
  let toggleNotice = '';
  let statusAccount: string | undefined;
  let batchEpoch = 0, batchAccount: string | undefined;
  let lastBatch: PopupBatchProgress | null = null, batchActionBusy = false;
  let seenBatchKey: string | undefined;
  const batchCard = document.querySelector<HTMLElement>('#github-batch-card');
  const batchResume = document.querySelector<HTMLButtonElement>('#github-batch-resume');
  const batchCancel = document.querySelector<HTMLButtonElement>('#github-batch-cancel');
  const batchMessage = document.querySelector<HTMLElement>('#github-batch-action-message');
  async function refreshBatch(): Promise<void> {
    if (!services.loadBatchProgress || !batchCard) return;
    const epoch = ++batchEpoch;
    try {
      const { progress } = await services.loadBatchProgress();
      if (epoch !== batchEpoch) return;
      if (!progress || (statusAccount !== undefined && progress.accountId !== statusAccount)) {
        batchCard.hidden = true; batchAccount = undefined; lastBatch = null; seenBatchKey = undefined;
        if (batchMessage) batchMessage.hidden = true;
        return;
      }
      const batchKey = JSON.stringify([progress.accountId, progress.taskId]);
      // Keep this popup's finished result until it is closed/reloaded. Previously
      // finished jobs do not reappear when a new popup session starts.
      if (progress.status === 'DONE' && seenBatchKey !== batchKey) {
        batchCard.hidden = true; batchAccount = undefined; lastBatch = null;
        if (batchMessage) batchMessage.hidden = true;
        return;
      }
      seenBatchKey = batchKey;
      if (lastBatch?.taskId !== progress.taskId && batchMessage) batchMessage.hidden = true;
      lastBatch = progress;
      batchAccount = progress.accountId; batchCard.hidden = false;
      if (batchResume) { batchResume.hidden = !services.batchAction || progress.status !== 'PAUSED'; batchResume.disabled = batchActionBusy; batchResume.textContent = progress.cancelRequested ? '상태 다시 확인' : '작업 이어가기'; }
      if (batchCancel) { batchCancel.hidden = !services.batchAction || progress.status === 'DONE' || progress.cancelRequested; batchCancel.disabled = batchActionBusy; }
      const labels = { REQUESTING: '접수 중', TRACKING: '진행 중', DONE: progress.cancelRequested ? '추가 요청 중단' : '처리 완료', PAUSED: '확인 필요' };
      document.querySelector<HTMLElement>('#github-batch-state')!.textContent = labels[progress.status];
      const bar = document.querySelector<HTMLProgressElement>('#github-batch-progress')!; bar.max = progress.total; bar.value = progress.processed;
      document.querySelector<HTMLElement>('#github-batch-counts')!.textContent = `처리 ${progress.processed}/${progress.total}건 (${Math.floor(progress.processed / progress.total * 100)}%)`;
      document.querySelector<HTMLElement>('#github-batch-detail')!.textContent = `접수 ${progress.requested}건 · 성공 ${progress.completed}건 · 실패 ${progress.failed}건 · 확인 필요 ${progress.unknown}건`;
    } catch { if (epoch === batchEpoch && !batchCard.hidden) document.querySelector<HTMLElement>('#github-batch-state')!.textContent = '진행 상태 확인 실패'; }
  }
  async function batchAction(action: PopupBatchAction['action']) {
    const progress = lastBatch;
    if (batchActionBusy || !services.batchAction || !progress) return;
    batchActionBusy = true; batchEpoch++;
    if (batchResume) batchResume.disabled = true; if (batchCancel) batchCancel.disabled = true;
    if (batchMessage) { batchMessage.hidden = false; batchMessage.textContent = '작업 요청을 확인하고 있습니다…'; }
    try {
      const result = await services.batchAction({ action, taskId: progress.taskId, accountId: progress.accountId });
      if (lastBatch?.taskId !== progress.taskId || batchAccount !== progress.accountId) return;
      if (batchMessage) batchMessage.textContent = result.ok ? action === 'CANCEL' ? '추가 요청을 중단했습니다. 이미 접수한 커밋은 계속 처리됩니다.' : '작업 상태를 다시 확인합니다.' : '작업이 변경됐거나 요청을 확인하지 못했습니다. 최신 상태를 확인해 주세요.';
    } catch { if (lastBatch?.taskId === progress.taskId && batchAccount === progress.accountId && batchMessage) batchMessage.textContent = '작업 요청을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'; }
    finally { batchActionBusy = false; void refreshBatch(); }
  }
  batchResume?.addEventListener('click', () => void batchAction('RESUME'));
  batchCancel?.addEventListener('click', () => void batchAction('CANCEL'));
  document.querySelector<HTMLButtonElement>('#github-batch-dashboard')?.addEventListener('click', () => services.openDashboard?.('github'));
  let knownStatuses = new Map<string, GithubCommitStatus>();
  let knownLinks = new Map<string, string>();
  let recentRenderKey: string | undefined;
  let visibleCaptures: Preview[] = [];
  let statusContext = '', statusEpoch = 0, statusInFlight = false, statusRefreshPending = false;
  const showRecent = (captures: Preview[]) => {
    const key = JSON.stringify(captures);
    if (key === recentRenderKey) return;
    recentRenderKey = key;
    renderRecent(document, recentList, recentEmpty, captures, services);
  };
  const showCurrentRecent = () => showRecent(visibleCaptures.map(capture => ({ ...capture, githubCommitStatus: knownStatuses.get(capture.captureId), githubUrl: knownLinks.get(capture.captureId) })));
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
        const link = response.links?.[id];
        if (typeof link === 'string') knownLinks.set(id, link);
      }
      showCurrentRecent();
    } catch { /* Missing remote evidence retains the last confirmed display. */ }
    finally {
      statusInFlight = false;
      if (statusRefreshPending) { statusRefreshPending = false; void refreshStatuses(); }
    }
  }
  type PopupSettings = NonNullable<typeof githubState> & { autoSyncEnabled?: boolean; relay?: { status?: string } };
  function applySettings(settings: PopupSettings, pendingCount: unknown, recentError: boolean): void {
    githubAuto.checked = settings.githubAutoCommitEnabled === true; githubAuto.setAttribute('aria-checked', String(githubAuto.checked));
    githubState = settings;
    localReady = true;
    githubAuto.disabled = false; setChecking(false);
    const relayStatus = settings.relay?.status;
    if (pendingUploads) {
      const count = Number.isSafeInteger(pendingCount) && (pendingCount as number) > 0 ? pendingCount as number : 0;
      pendingUploads.hidden = count === 0;
      if (syncPending) syncPending.hidden = count === 0 || !services.syncPending;
      pendingUploads.textContent = count ? `임시 저장 ${count}개 · ${!settings.autoSyncEnabled ? '자동 동기화를 켜면 전송됩니다.' : relayStatus === 'AUTH_EXPIRED' ? '같은 계정으로 로그인하면 자동 전송됩니다.' : '연결되면 자동 전송됩니다. 브라우저를 다시 켜도 이어집니다.'}` : '';
    }
    automationStatus.textContent = recentError ? '서버 연결 확인 필요' : relayStatus === 'CONFIRMED' ? '자동 동기화 중' : relayStatus === 'OFFLINE' ? '오프라인' : relayStatus === 'RELAY_ERROR' ? '동기화 오류' : '대시보드 로그인 필요';
    retryRelay.hidden = !services.retryRelay || (!recentError && relayStatus !== 'OFFLINE' && relayStatus !== 'RELAY_ERROR');
  }
  async function load(): Promise<void> {
    if (githubBusy) { reloadPending = true; return; }
    if (loading) { reloadPending = true; return; }
    loading = true;
    const epoch = localEpoch;
    let settled = false;
    error.hidden = true; recentError.hidden = true; recentCard.setAttribute('aria-busy', 'true');
    if (!localReady && services.loadLocal) {
      // The server recent list can wait on a cold API; the switch only needs local settings.
      void services.loadLocal().then(value => {
        const local = value as { settings?: PopupSettings; pendingCount?: unknown; error?: unknown } | null;
        if (settled || localReady || epoch !== localEpoch || githubBusy || !local?.settings || local.error) return;
        applySettings(local.settings, local.pendingCount, false);
        if (local.settings.relay?.status === 'CONFIRMED') automationStatus.textContent = '서버 확인 중';
      }).catch(() => undefined);
    }
    try {
      const state = await services.load() as { settings?: PopupSettings; pendingCount?: unknown; recentCaptures?: unknown; recentError?: unknown; error?: unknown } | null;
      if (epoch !== localEpoch || githubBusy) { reloadPending = true; return; }
      if (!state?.settings || state.error) throw new Error('Invalid state');
      if (statusAccount !== state.settings.accountId) {
        batchEpoch++; if (batchCard && batchAccount !== state.settings.accountId) { batchCard.hidden = true; lastBatch = null; seenBatchKey = undefined; }
        knownStatuses.clear(); knownLinks.clear(); statusAccount = state.settings.accountId;
        void refreshBatch();
      }
      const seen = new Set<string>();
      const captures = (Array.isArray(state.recentCaptures) ? state.recentCaptures : []).filter(asSynced)
        .filter(capture => { const key = `${capture.platform}:${capture.problemNumber}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
      // A replacement submission must never inherit the previous problem's status.
      knownStatuses = new Map(captures.flatMap(capture => {
        const status = knownStatuses.get(capture.captureId) ?? capture.githubCommitStatus;
        return status ? [[capture.captureId, status] as const] : [];
      }));
      knownLinks = new Map([...knownLinks].filter(([captureId]) => knownStatuses.has(captureId)));
      visibleCaptures = captures;
      const nextStatusContext = JSON.stringify([state.settings.accountId, state.settings.accountSettingsVersion, captures.map(capture => capture.captureId)]);
      if (nextStatusContext !== statusContext) { statusContext = nextStatusContext; statusEpoch++; }
      applySettings(state.settings, state.pendingCount, !!state.recentError);
      if (toggleNotice) { error.hidden = false; error.textContent = toggleNotice; }
      recentCount.textContent = captures.length ? `${captures.length}문제` : '없음'; showCurrentRecent();
      if (state.recentError) { recentError.hidden = false; recentEmpty.hidden = true; recentCount.textContent = '확인 실패'; }
      else recentEmpty.hidden = captures.length > 0;
      // Remote polling coalesces independently: local captures and controls stay responsive.
      void refreshStatuses();
    } catch {
      if (epoch !== localEpoch || githubBusy) { reloadPending = true; return; }
      githubState = undefined; githubAuto.disabled = true; setChecking(false);
      localReady = false;
      knownStatuses.clear(); statusAccount = undefined; recentRenderKey = undefined;
      visibleCaptures = []; statusEpoch++; statusContext = '';
      if (pendingUploads) { pendingUploads.hidden = true; pendingUploads.textContent = ''; }
      error.hidden = false; recentError.hidden = false; automationStatus.textContent = '확인 필요'; retryRelay.hidden = true;
      error.textContent = '동기화 상태를 불러오지 못했어요. 팝업을 다시 열어 주세요.';
      recentList.replaceChildren(); recentCount.textContent = '확인 실패'; recentEmpty.hidden = true;
    } finally {
      settled = true;
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
    githubBusy = true; localEpoch++; statusEpoch++; githubAuto.disabled = true; toggleNotice = ''; error.hidden = true;
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
  services.subscribeProgress?.(() => { void refreshBatch(); void load(); });
  syncPending?.addEventListener('click', () => {
    if (syncingPending || !services.syncPending) return;
    syncingPending = true; syncPending.disabled = true; syncPending.textContent = '동기화 중…';
    if (syncPendingResult) syncPendingResult.hidden = true;
    void services.syncPending().then(response => {
      if (syncPendingResult) { syncPendingResult.textContent = pendingSyncMessage(response); syncPendingResult.hidden = false; }
    }).catch(() => {
      if (syncPendingResult) { syncPendingResult.textContent = pendingSyncMessage(null); syncPendingResult.hidden = false; }
    }).then(() => load()).finally(() => { syncingPending = false; syncPending.disabled = false; syncPending.textContent = '지금 동기화'; });
  });
  retryRelay.addEventListener('click', () => {
    if (retrying || !services.retryRelay) return;
    retrying = true; retryRelay.disabled = true; retryRelay.textContent = '재시도 중…';
    void services.retryRelay().catch(() => undefined).then(() => load()).finally(() => { retrying = false; retryRelay.disabled = false; retryRelay.textContent = '연결 재시도'; });
  });
  void refreshBatch(); void load();
}
