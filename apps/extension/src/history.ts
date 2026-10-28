import { reconcileSubmissions, type ReconciliationRow, type ReconciliationSubmission } from '../../../shared/submissionReconciliation';
import type { ReconciliationEvidence } from './reconciliationEvidence';
import { selectHistoricalSubmissionIds, type HistoricalSelectionMode } from "../../../shared/historicalSelection";
import { HISTORY_TIMING_STORAGE_KEY, estimateHistoricalTotalDuration, readHistoricalTimingSample, type HistoricalTimingSample } from "./historyTiming";
import { isHistoricalCollectionScope, isTrustedHistoricalCollectionRequest, type HistoricalCollectionNotice } from '../../../shared/historicalCollectionScope';
import type { HistoryServerPlatform, HistoryServerResult } from '../../../shared/historyServerProtocol';

type Platform = "JUNGOL" | "SWEA" | "PROGRAMMERS";
type Candidate = ReconciliationSubmission & { submissionId: string; problemNumber: string; title: string; language?: string; createdAt?: string; executionTime?: number; memoryValue?: number;
  savedCode?: boolean };
type State = { status: string; candidates?: Candidate[]; truncated?: boolean; progress?: {
  phase: string; stage?: string; rows: number; pagesLoaded: number; groupsExpanded: number; groupsTotal: number; groupsTotalKnown?: boolean;
  historiesRead?: number; historiesTotal?: number; currentProblemNumber?: string;
  lastProgressAt?: number; sourceVisibility?: "visible" | "hidden" | "prerender" | "unknown";
}; completed?: number; total?: number; saved?: number; duplicate?: number;
  startedAt?: number; endedAt?: number; lastProgressAt?: number; timingSample?: unknown;
  failureReason?: string; failurePage?: number; failedProblemNumber?: string;
  storedSubmissionIds?: string[];
  serverAccount?: string; serverRunId?: string;
  skipped?: number; failedSubmissionIds?: string[]; verificationFailures?: Record<string, number>;
  problemCount?: number; submissionCount?: number; unsupportedProblemNumbers?: string[]; unreadProblemNumbers?: string[];
  sourceForegrounded?: boolean; sourceStalled?: boolean; sourceOpenFailure?: string; identityReason?: string };
export type HistoryServices = { send: (message: unknown) => Promise<unknown>;
  schedule?: (work: () => void, delay: number) => unknown; now?: () => number;
  readTiming?: () => Promise<unknown>;
  onCollectionNotice?: (notice: HistoricalCollectionNotice) => void;
  server?: (operation: 'IDS', platform: HistoryServerPlatform, account?: string, capture?: unknown) => Promise<HistoryServerResult>;
  subscribeCollectionRequest?: (publish: () => void) => void };

const platformInfo: Record<Platform, { description: string; guide: string }> = {
  JUNGOL: { description: "후보 찾기를 누르면 확장이 정올 제출현황을 새 창에서 열어 앞으로 가져오고, 끝나면 닫습니다. 이 화면의 탭은 그대로 유지됩니다. 정올은 창이 다른 창에 가려지거나 최소화되어 백그라운드가 되면 응답하지 않아 수집이 진행되지 않을 수 있으니, 수집이 끝날 때까지 정올 창을 이 화면과 나란히 두고 가리거나 최소화하지 말아 주세요.", guide: "우측 상단 프로필 → 내 정보 → 제출현황에서 내 제출 내역을 열어 주세요." },
  SWEA: { description: "후보 찾기를 누르면 확장이 SWEA 제출 목록을 백그라운드 탭에서 열고, 끝나면 닫습니다. SWEA가 백그라운드에서 응답하지 않으면 그 탭을 앞으로 가져옵니다.", guide: "My Page Code에서 제출한 Problem을 열어 주세요." },
  PROGRAMMERS: { description: "후보 찾기를 누르면 확장이 해결한 문제 목록을 백그라운드 탭에서 열고, 문제 상세도 뒤쪽 탭에서 읽은 뒤 닫습니다. 프로그래머스가 백그라운드에서 응답하지 않으면 목록 탭을 앞으로 가져옵니다. 제출 이력에는 실행시간·메모리가 없어 해당 정보는 저장할 수 없으며, 가장 빠른 제출·최소 메모리 선택도 지원하지 않습니다. SQL 문제는 제출 이력이 없어 편집기에 저장된 마지막 코드를 문제 목록의 해결 시각으로 가져옵니다.", guide: "해결한 문제 목록을 열어 주세요. 문제 상세는 같은 사이트 창의 뒤쪽 탭에서 열리고 처리 후 닫힙니다." }
};

export function mountHistory(doc: Document, services: HistoryServices) {
  const send = services.send;
  let lastNotice = '';
  let currentNotice: HistoricalCollectionNotice = { type: 'CODEARCHIVE_HISTORY_COLLECTION', scope: null };
  services.subscribeCollectionRequest?.(() => services.onCollectionNotice?.(currentNotice));
  const notifyCollection = (scope: HistoricalCollectionNotice['scope']) => {
    const notice: HistoricalCollectionNotice = { type: 'CODEARCHIVE_HISTORY_COLLECTION', scope };
    currentNotice = notice;
    const key = JSON.stringify(notice);
    if (key !== lastNotice) { lastNotice = key; services.onCollectionNotice?.(notice); }
  };
  const scan = doc.querySelector<HTMLButtonElement>("#scan")!;
  const cancel = doc.querySelector<HTMLButtonElement>("#cancel")!;
  const importButton = doc.querySelector<HTMLButtonElement>("#import")!;
  const policy = doc.querySelector<HTMLSelectElement>("#selection")!;
  const platformSelect = doc.querySelector<HTMLSelectElement>("#platform")!;
  const description = doc.querySelector<HTMLElement>("#platform-description")!;
  const status = doc.querySelector<HTMLElement>("#status")!;
  const progress = doc.querySelector<HTMLElement>("#progress")!;
  const progressBar = doc.querySelector<HTMLProgressElement>("#task-progress")!;
  const taskStage = doc.querySelector<HTMLElement>("#task-stage");
  const taskTime = doc.querySelector<HTMLElement>("#task-time");
  const now = services.now ?? (() => Date.now());
  const candidatesPanel = doc.querySelector<HTMLElement>("#candidates")!;
  const list = doc.querySelector<HTMLElement>("#candidate-list")!;
  const help = doc.querySelector<HTMLElement>("#candidate-help")!;
  const reconciliationButton = doc.querySelector<HTMLButtonElement>("#reconcile");
  const verifyExisting = doc.querySelector<HTMLButtonElement>("#verify-existing");
  const clearReconciliation = doc.querySelector<HTMLButtonElement>("#clear-reconciliation");
  const reconciliationStatus = doc.querySelector<HTMLElement>("#reconciliation-status");
  const reconciliationHelp = doc.querySelector<HTMLElement>("#reconciliation-help");
  let reconciliation: ReconciliationRow[] | null = null;
  let reconciliationEpoch = 0, reconciliationBusy = false;
  let candidates: Candidate[] = [], localIds = new Set<string>(), selected = new Set<string>();
  // Submissions the server already holds as live captures: they have no site
  // submission id, so the extension matches them by problem, language and time.
  let liveMatchedIds = new Set<string>();
  const existing = (id: string) => localIds.has(id) || liveMatchedIds.has(id);
  let pollingEpoch: number | null = null, readyForImport = false, platformEpoch = 0, taskActive = false;
  let timingSample: HistoricalTimingSample | null = null;
  let serverAccount: string | null = null, registrationAccount: string | null = null;
  let registrationSelection: Set<string> | null = null;
  let registrationRunId: string | null = null;
  let serverError = '', serverBusy = false;
  const serverMode = !!services.server;
  if (serverMode) {
    doc.body.classList.add('server-history');
    const heading = doc.querySelector('.collection-card h2'); if (heading) heading.textContent = '수집 · 서버 등록';
    const note = doc.querySelector('#source-note'); if (note) note.textContent = '수집 중에는 이 화면을 열어 두세요. 사이트 내역은 확장이 탭에서 열고 끝나면 닫습니다. 정올은 창이 가려지거나 최소화되면 진행되지 않을 수 있어 새 창을 앞으로 가져옵니다. 선택한 제출은 원본 확인 후 로그인한 계정의 서버에 등록됩니다.';
    const collection = doc.querySelector('.collection-card'); collection?.setAttribute('aria-label', '서버 수집');
    for (const element of [reconciliationButton, verifyExisting, clearReconciliation]) if (element) element.hidden = true;
  }
  const platform = (): Platform => platformSelect.value as Platform;
  const validState = (value: unknown): State | null => value && typeof value === "object" && typeof (value as State).status === "string" ? value as State : null;
  function label(state: State) {
    const unsupportedNotice = state.unsupportedProblemNumbers?.length
      ? ` 편집기에 가져올 코드가 없는 SQL 문제 ${state.unsupportedProblemNumbers.length}건(빈 코드·초기 코드·지원하지 않는 언어)은 수집 대상에서 제외했습니다.` : "";
    const savedCodeProblems = new Set((state.candidates ?? []).filter(item => item.savedCode === true).map(item => item.problemNumber)).size;
    const savedCodeNotice = savedCodeProblems
      ? ` SQL 문제 ${savedCodeProblems}건은 제출 이력이 없어 편집기에 저장된 마지막 코드를 후보로 보여 줍니다. 정답을 낸 뒤 코드를 고쳤다면 정답과 다를 수 있습니다.` : "";
    const unread = state.unreadProblemNumbers ?? [];
    const unreadNotice = unread.length ? ` 제출 이력을 읽지 못한 문제 ${unread.length}건(${unread.slice(0, 5).map(number => `#${number}`).join(", ")}${unread.length > 5 ? ` 외 ${unread.length - 5}건` : ""})은 이번 후보에서 빠졌습니다. 후보 찾기를 다시 누르면 다시 읽습니다.` : "";
    if (state.status === "SCANNING") return "목록을 확인하고 있어요.";
    if (state.status === "IMPORTING") return `${serverMode ? '원본 확인 · 서버 등록 중' : '로컬 저장 중'} ${state.completed ?? 0}/${state.total ?? 0}건`;
    if (state.status === "CANCELLING") return `현재 제출 처리를 마무리하는 중입니다. ${state.completed ?? 0}/${state.total ?? 0}건 처리했습니다.`;
    const resultSummary = () => {
      const submissions = typeof state.submissionCount === "number" ? state.submissionCount : (state.saved ?? 0) + (state.duplicate ?? 0);
      const problems = typeof state.problemCount === "number" ? `문제 ${state.problemCount}건 · ` : "";
      const failures = state.skipped ? ` · 확인 실패 ${state.skipped}건${state.failedSubmissionIds?.length ? ` (제출 ${state.failedSubmissionIds.map(id => `#${id}`).join(", ")})` : ""}` : "";
      const reasons: Record<string, string> = { context: "문제 연결 확인 실패", source: "원본 코드 확인 실패", title: "문제 제목 확인 실패", length: "원본 코드 길이 불일치", metadata: "제출 정보 확인 실패" };
      const details = Object.entries(state.verificationFailures ?? {}).filter(([reason, count]) => reasons[reason] && Number.isSafeInteger(count) && count > 0)
        .map(([reason, count]) => `${reasons[reason]} ${count}건`).join(" · ");
      return `${problems}제출 ${submissions}건 · 새로 저장 ${state.saved ?? 0}건 · 이미 저장됨 ${state.duplicate ?? 0}건${failures}${details ? ` · ${details}` : ""}`;
    };
    if (state.status === "DONE") return serverMode ? `원본 확인 완료 · ${resultSummary().replace('새로 저장', '확인 완료').replace('이미 저장됨', '재확인')} ${unsupportedNotice}${unreadNotice}` : `로컬 저장 완료 · ${resultSummary()}${unsupportedNotice}${unreadNotice}`;
    if (state.status === "INTERRUPTED" && (state.completed ?? 0) > 0) return `수집이 중단되었습니다. 현재까지 ${resultSummary()}`;
    const failureLabels: Record<string, string> = {
      LIST_CHANGED: "제출 목록이 바뀌었습니다. 후보 찾기를 다시 실행해 주세요.",
      DETAIL_NOT_FOUND: platform() === "JUNGOL" ? "제출 상세를 열지 못했습니다. 정올 창을 확인해 주세요." : `제출 상세를 열지 못했습니다. ${platformInfo[platform()].guide}`,
      DETAIL_UNVERIFIED: "제출 상세의 본인·정답·원본 코드·제출 시각을 확인하지 못했습니다.",
      STORE_REJECTED: platform() === "JUNGOL" ? "로컬 저장 요청이 거부되었습니다. 확장과 정올 탭의 연결을 확인해 주세요." : `로컬 저장 요청이 거부되었습니다. ${platformInfo[platform()].guide}`,
      STORE_FAILED: "로컬 저장 요청을 완료하지 못했습니다. 확장 연결과 저장 공간을 확인해 주세요."
    };
    if (state.status === "FAILED" && state.failureReason && failureLabels[state.failureReason])
      return `${failureLabels[state.failureReason]}${(state.completed ?? 0) > 0 ? ` 현재까지 ${resultSummary()}` : ""}`;
    if (state.status === "FAILED" && (state.completed ?? 0) > 0) return `수집을 완료하지 못했습니다. 현재까지 ${resultSummary()}`;
    if (state.status === "TAB_NOT_FOUND") {
      const name = platform() === "JUNGOL" ? "정올" : platform() === "SWEA" ? "SWEA" : "프로그래머스";
      const causes: Record<string, string> = { WINDOW: "정올 창을 열지 못했습니다", HOME_LOAD: "정올 첫 화면을 불러오지 못했습니다",
        NO_ACCOUNT_LINK: "정올 첫 화면에서 내 계정 링크를 찾지 못했습니다", NOT_OWNER: "정올 첫 화면의 계정 중 로그인한 본인 계정을 확인하지 못했습니다",
        LIST_LOAD: "정올 제출현황을 불러오지 못했습니다" };
      const cause = state.sourceOpenFailure && causes[state.sourceOpenFailure] ? ` (원인: ${causes[state.sourceOpenFailure]} · ${state.sourceOpenFailure})` : "";
      return `${name} 로그인 상태를 확인하지 못했습니다.${cause} ${name}에 로그인한 뒤 후보 찾기를 다시 눌러 주세요.`;
    }
    if (state.status === "CONNECTION_REQUIRED") return platform() === "JUNGOL" ? "정올 제출현황을 열고 후보 찾기를 다시 눌러 주세요. 수집 연결을 복구합니다." : `${platformInfo[platform()].guide} 후보 찾기를 다시 눌러 주세요.`;
    if (state.status === "CONNECTION_FAILED") return platform() === "JUNGOL" ? "정올 탭과 연결하지 못했습니다. 제출현황을 새로고침한 뒤 후보 찾기를 다시 눌러 주세요." : `${platformInfo[platform()].guide} 새로고침한 뒤 다시 눌러 주세요.`;
    if (state.status === "MULTIPLE_TABS") return platform() === "JUNGOL" ? "정올 제출 탭이 여러 개입니다. 하나만 남긴 뒤 다시 시도해 주세요." : `${platformInfo[platform()].guide} 탭을 하나만 남긴 뒤 다시 눌러 주세요.`;
    if (state.status === "INTERRUPTED") return "원본 탭이 닫혔거나 이동했습니다. 저장된 항목은 유지됩니다.";
    if (state.status === "OWNERSHIP_UNVERIFIED" || state.status === "LOGIN_REQUIRED") {
      const missing: Record<string, string> = { NO_EDIT_TAB: "내 프로필의 정보 수정 탭", NO_ACTIVE_TAB: "제출현황 탭", NO_ACCOUNT_NAME: "계정 이름" };
      const detail = state.identityReason && missing[state.identityReason] ? ` (찾지 못한 항목: ${missing[state.identityReason]} · ${state.identityReason})` : "";
      return `로그인한 본인의 제출 이력을 확인하지 못했습니다.${detail} 원본 사이트의 로그인 상태를 확인해 주세요.`;
    }
    if (state.status === "SCAN_INCOMPLETE" && state.failurePage) {
      const where = state.failedProblemNumber ? `문제 #${state.failedProblemNumber}의 제출 이력 ${state.failurePage}페이지` : `문제 목록 ${state.failurePage}페이지`;
      return `${where}를 확인하지 못해 후보 찾기를 중단했습니다. 원본 사이트에서 해당 목록을 확인한 뒤 다시 시도해 주세요.`;
    }
    if (state.status === "SCAN_INCOMPLETE" && state.failedProblemNumber)
      return `문제 #${state.failedProblemNumber}까지 제출 이력을 연달아 읽지 못해 후보 찾기를 중단했습니다. 사이트 로그인 상태와 해당 문제 페이지를 확인한 뒤 다시 시도해 주세요.`;
    if (state.status === "SCAN_INCOMPLETE") return "목록이 끝까지 열리지 않았습니다. 원본 탭을 유지한 뒤 다시 시도해 주세요.";
    if (state.status === "FAILED") return "수집을 완료하지 못했습니다. 원본 탭 상태를 확인해 주세요.";
    return state.status === "READY" ? `후보 목록을 확인했습니다.${savedCodeNotice}${unsupportedNotice}${unreadNotice}` : platformInfo[platform()].guide;
  }
  function clearCandidates() { reconciliationEpoch++; reconciliationBusy = false; reconciliation = null; if (reconciliationStatus) reconciliationStatus.textContent = ""; if (clearReconciliation) clearReconciliation.hidden = true; if (verifyExisting) verifyExisting.hidden = true; if (reconciliationHelp) reconciliationHelp.hidden = true; candidates = []; selected.clear(); readyForImport = false; candidatesPanel.hidden = true; list.replaceChildren(); }
  function formatElapsed(milliseconds: number) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const hours = Math.floor(seconds / 3_600), minutes = Math.floor(seconds % 3_600 / 60), remainder = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` :
      `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  function renderTiming(state: State) {
    if (!taskTime) return;
    if (typeof state.startedAt !== "number" || typeof state.total !== "number" || state.total < 1) {
      taskTime.hidden = true; taskTime.textContent = ""; return;
    }
    taskTime.hidden = false;
    const finishedAt = typeof state.endedAt === "number" ? state.endedAt : now();
    const estimatedTotal = estimateHistoricalTotalDuration(state, timingSample);
    taskTime.textContent = `진행 시간 ${formatElapsed(finishedAt - state.startedAt)} / 예상 총 시간 ${estimatedTotal === null ? "?시간" : formatElapsed(estimatedTotal)}`;
  }
  function selectedInCandidateOrder() {
    return candidates.filter(item => allowedForRecovery(item) && selected.has(item.submissionId)).map(item => item.submissionId);
  }
  function allowedForRecovery(item: Candidate) {
    if (!reconciliation) return !existing(item.submissionId);
    const state = reconciliation.find(row => row.submissionId === item.submissionId)?.state;
    return state === "missing_local" || state === "enrichment_available";
  }
  function render() {
    const allowed = reconciliation ? candidates : candidates.filter(item => !existing(item.submissionId));
    selected = new Set([...selected].filter(id => allowed.some(item => item.submissionId === id && allowedForRecovery(item))));
    list.replaceChildren();
    for (const candidate of allowed) {
      const row = doc.createElement("label"); row.className = "row";
      const checkbox = doc.createElement("input"); checkbox.disabled = !allowedForRecovery(candidate); checkbox.type = "checkbox"; checkbox.checked = selected.has(candidate.submissionId); checkbox.setAttribute("aria-label", `제출 #${candidate.submissionId}`);
      checkbox.addEventListener("change", () => { checkbox.checked ? selected.add(candidate.submissionId) : selected.delete(candidate.submissionId); render(); });
      const title = doc.createElement("span"); title.textContent = `#${candidate.problemNumber} · ${candidate.title}`;
      const meta = doc.createElement("small"); meta.className = "meta";
      meta.textContent = platform() === "PROGRAMMERS"
        ? `${candidate.createdAt ?? "제출 시각 확인됨"}${candidate.language ? ` · ${candidate.language}` : ""}${candidate.savedCode === true ? " · 편집기 저장 코드(정답 제출과 다를 수 있음)" : ""}`
        : `제출 #${candidate.submissionId}${candidate.executionTime !== undefined ? ` · ${candidate.executionTime}ms` : ""}${candidate.memoryValue !== undefined ? ` · ${candidate.memoryValue}${platform() === "SWEA" ? "KB" : "MB"}` : ""}`;
      if (reconciliation) {
        const state = reconciliation.find(item => item.submissionId === candidate.submissionId)?.state ?? "unsupported";
        const labels = { matched: "로컬·서버 제출 키 일치", missing_local: "로컬 기록 없음 · 원본 확인 후 복구 가능", missing_remote: "서버 기록 없음 · 관리 탭에서 동기화", enrichment_available: "정보 보강 가능 · 원본 재확인 필요", ambiguous: "동일 제출 확인 불가 · 자동 병합 제외", unsupported: "대조 미확인" };
        meta.textContent += ` · ${labels[state]}`;
      }
      row.append(checkbox, title, meta); list.append(row);
    }
    const problemCount = new Set(allowed.map(item => `${platform()}:${item.problemNumber}`)).size;
    const summary = `후보 문제 ${problemCount}건 · 제출 ${allowed.length}건`;
    const excluded = candidates.length - allowed.length;
    const excludedLive = reconciliation ? 0 : candidates.filter(item => !localIds.has(item.submissionId) && liveMatchedIds.has(item.submissionId)).length;
    help.textContent = selected.size > 5_000 ? `${summary} · 한 번에 최대 5,000개 제출을 저장할 수 있습니다. 선택 범위를 줄여 주세요.` :
      excluded ? `${summary} · 이미 ${serverMode ? '서버에 등록된' : '이 브라우저에 저장한'} 제출 ${excluded}건${excludedLive ? `(실시간 수집 ${excludedLive}건 포함)` : ''}은 후보에서 제외했습니다.` : summary;
    importButton.textContent = reconciliation ? `선택한 ${selected.size}건 원본 검증·복구/보강` : `선택한 ${selected.size}건 ${serverMode ? '서버 등록' : '로컬 저장'}`;
    if (reconciliationButton) reconciliationButton.disabled = reconciliationBusy || taskActive || !readyForImport || platform() === "JUNGOL";
    importButton.disabled = serverBusy || taskActive || !readyForImport || selected.size === 0 || selected.size > 5_000;
  }
  function showPlatform() {
    notifyCollection(null);
    registrationSelection = null; registrationAccount = null; registrationRunId = null; serverError = '';
    const current = platform(), info = platformInfo[current];
    description.textContent = serverMode ? info.description.replace('이 브라우저에 로컬로 저장', '서버에 등록').replaceAll('로컬에 저장', '서버에 등록') : info.description;
    clearCandidates(); progressBar.hidden = true; progress.textContent = ""; if (taskStage) taskStage.textContent = ""; if (taskTime) { taskTime.textContent = ""; taskTime.hidden = true; }
    cancel.hidden = true; policy.disabled = false; platformSelect.disabled = false; taskActive = false;
    const performanceUnavailable = current === "PROGRAMMERS";
    const policyOptions = [...policy.querySelectorAll<HTMLOptionElement>("option")];
    for (const option of policyOptions) {
      option.disabled = performanceUnavailable && (option.value === "fastest" || option.value === "lowest-memory");
    }
    if (policyOptions.find(option => option.selected)?.disabled) policy.value = "latest";
    scan.textContent = `${current === "JUNGOL" ? "정올" : current === "SWEA" ? "SWEA" : "프로그래머스"} 제출 후보 찾기`;
    scan.disabled = false;
    status.textContent = "원본 제출 이력 탭을 확인하세요.";
    render();
  }
  const ownsPlatform = (expected: Platform, epoch: number) => platform() === expected && epoch === platformEpoch;
  async function refreshLocalIds(expected: Platform = platform(), epoch = platformEpoch) {
    const ids = serverMode ? await services.server!('IDS', expected) : (await send({ type: "LOCAL_HISTORY_IDS", platform: expected })) as { submissionIds?: unknown };
    if (!ownsPlatform(expected, epoch)) return false;
    if (serverMode) {
      const result = ids as HistoryServerResult;
      if (!result.account || !Array.isArray(result.submissionIds) || result.submissionIds.some(id => typeof id !== 'string')) throw new Error('서버 제출 기록을 확인하지 못했습니다. 다시 시도해 주세요.');
      if (serverAccount && serverAccount !== result.account) throw new Error('로그인 계정이 변경되었습니다. 과거 풀이 관리 화면을 다시 열어 주세요.');
      serverAccount = result.account;
    }
    localIds = new Set(Array.isArray(ids.submissionIds) ? ids.submissionIds.filter(id => typeof id === "string" && id.length <= 300) : []); return true;
  }
  async function matchLiveCaptures(expected: Platform, epoch: number) {
    const shown = candidates;
    // Programmers lists the time as createdAt, SWEA as solvedAt; a row without a time can never match a live capture.
    const rows = shown.map(item => ({ submissionId: item.submissionId, problemNumber: item.problemNumber,
      ...(item.language ? { language: item.language } : {}), ...((item.createdAt ?? item.solvedAt) ? { solvedAt: (item.createdAt ?? item.solvedAt)! } : {}) }));
    type MatchResponse = { ok?: unknown; existing?: unknown } | null;
    let response: MatchResponse = null;
    try { response = await send({ type: "HISTORY_SERVER_MATCH", platform: expected, rows }) as MatchResponse; } catch { response = null; }
    if (!ownsPlatform(expected, epoch) || candidates !== shown) return;
    if (response?.ok !== true || !Array.isArray(response.existing)) {
      status.textContent = "서버에 이미 있는 실시간 수집 풀이를 확인하지 못해 등록을 멈췄습니다. 후보 찾기를 다시 눌러 주세요."; render(); return;
    }
    liveMatchedIds = new Set(response.existing.filter((id): id is string => typeof id === "string"));
    selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !existing(item.submissionId)), policy.value as HistoricalSelectionMode));
    readyForImport = true; render();
  }
  async function loadTiming(expected: Platform = platform(), epoch = platformEpoch) {
    try {
      const value = await (services.readTiming ? services.readTiming() : chrome.storage.local.get(HISTORY_TIMING_STORAGE_KEY));
      if (!ownsPlatform(expected, epoch)) return;
      const record = value && typeof value === "object" && HISTORY_TIMING_STORAGE_KEY in value
        ? (value as Record<string, unknown>)[HISTORY_TIMING_STORAGE_KEY] : value;
      const sample = readHistoricalTimingSample(record);
      timingSample = sample?.platform === expected ? sample : null;
      render();
    } catch { /* An estimate is optional; collecting remains local and available. */ }
  }
  async function applyState(value: unknown, expected: Platform = platform(), epoch = platformEpoch) {
    if (!ownsPlatform(expected, epoch)) return;
    const state = validState(value); if (!state) { status.textContent = "확장 프로그램 응답을 확인할 수 없습니다."; return; }
    const completedScope = { batchId: `${expected}:${state.startedAt}`, platform: expected, submissionIds: state.storedSubmissionIds };
    const serverReceipts = state.serverAccount === serverAccount && Array.isArray(state.storedSubmissionIds) ? state.storedSubmissionIds : [];
    const registeredScope = { ...completedScope, submissionIds: serverReceipts };
    notifyCollection(serverMode ? ['DONE', 'FAILED', 'INTERRUPTED'].includes(state.status) && state.serverAccount === serverAccount && isHistoricalCollectionScope(registeredScope) ? registeredScope : null : state.status === 'DONE' && typeof state.total === 'number' && Number.isInteger(state.total) && state.total > 0 &&
      state.completed === state.total && isHistoricalCollectionScope(completedScope) && completedScope.submissionIds.length <= state.total ? completedScope : null);
    const active = state.status === "SCANNING" || state.status === "IMPORTING" || state.status === "CANCELLING";
    taskActive = active;
    const stateSample = readHistoricalTimingSample(state.timingSample);
    if (stateSample) timingSample = stateSample;
    status.textContent = label(state); scan.disabled = active; policy.disabled = active; platformSelect.disabled = active; cancel.hidden = !active; cancel.disabled = state.status === "CANCELLING";
    if (serverMode && state.serverAccount === serverAccount) {
      status.textContent = `${active ? '원본 확인 · 서버 등록 중' : state.status === 'DONE' ? '서버 등록 완료' : '서버 등록 중단'} · ${state.problemCount !== undefined ? `문제 ${state.problemCount}건 · ` : ''}제출 ${serverReceipts.length}건 등록${state.skipped ? ` · 확인·등록 실패 ${state.skipped}건` : ''}${serverError ? ` · ${serverError}` : ''}`;
    }
    renderTiming(state);
    if (state.progress) {
      const scanProgress = state.progress;
      progressBar.hidden = false;
      // Listing/group discovery has no reliable total until the site exposes one.
      const historiesTotalKnown = typeof scanProgress.historiesTotal === "number" && scanProgress.historiesTotal > 0 &&
        typeof scanProgress.historiesRead === "number";
      const groupTotalKnown = scanProgress.phase === "groups" && scanProgress.groupsTotalKnown === true && scanProgress.groupsTotal > 0;
      if (historiesTotalKnown) {
        progressBar.max = scanProgress.historiesTotal!; progressBar.value = Math.min(scanProgress.historiesRead!, scanProgress.historiesTotal!);
      } else if (groupTotalKnown) {
        progressBar.max = scanProgress.groupsTotal; progressBar.value = scanProgress.groupsExpanded;
      } else if (!active) { progressBar.max = 1; progressBar.value = 0; }
      else { progressBar.removeAttribute("value"); progressBar.removeAttribute("max"); }
      const waiting = scanProgress.stage === "waiting-pages" || scanProgress.stage === "waiting-groups";
      progress.textContent = historiesTotalKnown
        ? `문제 ${scanProgress.historiesTotal}건 · 제출 이력 ${scanProgress.historiesRead}/${scanProgress.historiesTotal}개 확인`
        : scanProgress.phase === "pages"
        ? `목록 행 ${scanProgress.rows}개 · ${scanProgress.pagesLoaded}개 페이지를 확인했습니다.`
        : groupTotalKnown
          ? `그룹 ${scanProgress.groupsExpanded}/${scanProgress.groupsTotal}개를 확인했습니다.`
          : `그룹 ${scanProgress.groupsExpanded}개를 확인했습니다.`;
      if (taskStage) taskStage.textContent = waiting
        ? `${scanProgress.stage === "waiting-pages" ? "다음 목록 또는 마지막 목록" : "그룹 펼침"} 응답을 기다리는 중${scanProgress.sourceVisibility === "hidden" ? " · 원본 탭이 백그라운드 상태입니다." : "."}`
        : scanProgress.phase === "pages" ? "목록을 읽는 중입니다." : historiesTotalKnown
          ? scanProgress.currentProblemNumber ? `문제 #${scanProgress.currentProblemNumber}의 제출 이력을 확인하는 중입니다.` : "문제별 제출 이력을 읽는 중입니다."
          : "그룹을 펼치는 중입니다.";
      if (!active && taskStage) taskStage.textContent = "목록 확인이 중단되었습니다.";
    } else if ((state.status === "IMPORTING" || state.status === "CANCELLING" || state.status === "DONE" || state.status === "FAILED" || state.status === "INTERRUPTED") &&
      typeof state.total === "number" && typeof state.completed === "number") {
      progressBar.hidden = false; progressBar.max = Math.max(1, state.total); progressBar.value = state.completed;
      const total = Math.max(0, state.total), completed = Math.max(0, state.completed);
      const percent = total ? Math.min(100, Math.floor(completed / total * 100)) : 0;
      progress.textContent = `${completed}/${total}건 처리했습니다. (${percent}%)`;
      if (taskStage) taskStage.textContent = state.status === "CANCELLING" ? "현재 제출 처리를 마무리하는 중입니다." :
        state.status === "IMPORTING" ? `제출을 확인하고 ${serverMode ? '서버에 등록' : '로컬에 저장'}하는 중입니다.` : "";
    } else { progressBar.hidden = true; progress.textContent = ""; if (taskStage) taskStage.textContent = ""; }
    // The source site only answers while its tab is in front; say what the extension did about it.
    if (taskStage && active && (state.sourceStalled || state.sourceForegrounded)) {
      const site = platform() === "JUNGOL" ? "정올" : platform() === "SWEA" ? "SWEA" : "프로그래머스";
      const note = state.sourceStalled
        ? `${site} 사이트가 백그라운드 탭에서는 응답하지 않습니다. ${site} 탭을 눌러 앞으로 가져와 주세요.`
        : platform() === "JUNGOL"
          ? "정올 창을 앞으로 가져왔습니다. 창이 가려지거나 최소화되어 백그라운드가 되면 정올이 응답하지 않아 진행되지 않을 수 있으니, 끝날 때까지 그대로 두어 주세요. 끝나면 창이 자동으로 닫힙니다."
          : `${site} 탭을 앞으로 가져왔습니다. 백그라운드에서는 사이트가 응답하지 않아 진행되지 않을 수 있으니, 끝날 때까지 그 탭을 유지해 주세요. 끝나면 이 화면으로 돌아옵니다.`;
      taskStage.textContent = taskStage.textContent ? `${taskStage.textContent} ${note}` : note;
    }
    if (state.status === "READY" && !state.truncated && Array.isArray(state.candidates)) {
      candidates = state.candidates.filter(item => typeof item.submissionId === "string" && item.submissionId.length > 0 && item.submissionId.length <= 300); liveMatchedIds = new Set();
      selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !existing(item.submissionId)), policy.value as HistoricalSelectionMode));
      // Registration waits until live captures are matched, so none is registered twice.
      readyForImport = !serverMode || !candidates.length; candidatesPanel.hidden = false; render();
      if (serverMode && candidates.length) void matchLiveCaptures(expected, epoch);
    } else if (state.status !== "READY") {
      readyForImport = false; if (state.status !== "SCANNING") clearCandidates();
      if (state.status === "DONE" || state.status === "FAILED" || state.status === "INTERRUPTED") {
        if (!serverMode) void refreshLocalIds(expected, epoch).then(ok => { if (ok) render(); }).catch(() => undefined);
        if (!stateSample) void loadTiming(expected, epoch);
      }
      render();
    }
    if (active) poll(expected, epoch);
  }
  function poll(expected: Platform, epoch: number) {
    if (pollingEpoch === epoch) return; pollingEpoch = epoch;
    (services.schedule ?? ((work, delay) => setTimeout(work, delay)))(async () => {
      if (pollingEpoch === epoch) pollingEpoch = null;
      if (!ownsPlatform(expected, epoch)) return;
      try { await applyState(await send({ type: "LOCAL_HISTORY_STATUS", platform: expected }), expected, epoch); }
      catch { if (ownsPlatform(expected, epoch)) { status.textContent = "현재 수집 상태를 확인하지 못했습니다. 새로고침하거나 다시 확인해 주세요."; scan.disabled = false; policy.disabled = false; platformSelect.disabled = false; } }
    }, 500);
  }
  async function loadPlatform() { const expected = platform(), epoch = platformEpoch; try { if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return; await applyState(await send({ type: "LOCAL_HISTORY_STATUS", platform: expected }), expected, epoch); } catch (error) { if (ownsPlatform(expected, epoch)) status.textContent = serverMode && error instanceof Error ? error.message : "확장 프로그램에 연결할 수 없습니다."; } }
  reconciliationButton?.addEventListener("click", async () => {
    const expected = platform(), epoch = platformEpoch;
    if (reconciliationBusy || !readyForImport || taskActive || expected === "JUNGOL") return;
    reconciliationBusy = true; const requestEpoch = ++reconciliationEpoch;
    reconciliationButton.disabled = true;
    if (reconciliationStatus) reconciliationStatus.textContent = "로컬·서버 제출 기록을 대조하고 있습니다.";
    try {
      const evidence = await send({ type: "LOCAL_HISTORY_RECONCILIATION", platform: expected }) as ReconciliationEvidence;
      if (!ownsPlatform(expected, epoch) || requestEpoch !== reconciliationEpoch || taskActive) return;
      if (!evidence || !Array.isArray(evidence.local) || !Array.isArray(evidence.remote) || typeof evidence.localComplete !== "boolean" || typeof evidence.remoteComplete !== "boolean") throw new Error("Unverified evidence");
      reconciliation = evidence.localComplete ? reconcileSubmissions(expected, candidates, evidence.local, evidence.remote, evidence.remoteComplete) : candidates.map(item => ({ submissionId: item.submissionId, state: "unsupported" as const }));
      selected = new Set(selectHistoricalSubmissionIds(candidates.filter(allowedForRecovery), policy.value as HistoricalSelectionMode));
      if (clearReconciliation) clearReconciliation.hidden = false;
      if (verifyExisting) verifyExisting.hidden = false;
      if (reconciliationHelp) reconciliationHelp.hidden = false;
      if (reconciliationStatus) reconciliationStatus.textContent = evidence.remoteComplete ? "본인 서버 기록 대조 완료. 복구·보강할 제출을 선택하세요." : "서버 대조를 확인하지 못했습니다. 로컬 기록만 확인했으며 서버 누락으로 판단하지 않습니다. 대시보드 로그인·연결을 확인하세요.";
      render();
    } catch { if (ownsPlatform(expected, epoch) && reconciliationStatus) reconciliationStatus.textContent = "기록을 대조하지 못했습니다. 기존 수집과 저장 기록은 유지됩니다."; }
    finally { if (requestEpoch === reconciliationEpoch) { reconciliationBusy = false; if (ownsPlatform(expected, epoch)) reconciliationButton.disabled = taskActive || !readyForImport; } }
  });
  verifyExisting?.addEventListener("click", () => {
    if (!reconciliation || taskActive) return;
    reconciliation = reconciliation.map(row => row.localCaptureId && ["matched", "missing_remote"].includes(row.state) ? { ...row, state: "enrichment_available" } : row);
    selected = new Set(selectHistoricalSubmissionIds(candidates.filter(allowedForRecovery), policy.value as HistoricalSelectionMode));
    if (reconciliationStatus) reconciliationStatus.textContent = "기존 제출 원본을 다시 확인합니다. 코드·문제·언어·시각이 일치하고 새로 확인한 정보가 있을 때만 빈 값을 보강합니다.";
    render();
  });
  clearReconciliation?.addEventListener("click", () => { reconciliation = null; selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !existing(item.submissionId)), policy.value as HistoricalSelectionMode)); clearReconciliation.hidden = true; if (verifyExisting) verifyExisting.hidden = true; if (reconciliationHelp) reconciliationHelp.hidden = true; if (reconciliationStatus) reconciliationStatus.textContent = ""; render(); });
  scan.addEventListener("click", async () => {
    if (scan.disabled) return;
    const expected = platform(), epoch = ++platformEpoch;
    registrationSelection = null; registrationAccount = null; registrationRunId = null; serverError = '';
    notifyCollection(null); clearCandidates(); render();
    scan.disabled = true; policy.disabled = true; platformSelect.disabled = true;
    try {
      if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return;
      await applyState(await send({ type: "LOCAL_HISTORY_SCAN_START", platform: expected }), expected, epoch);
    } catch (error) { if (ownsPlatform(expected, epoch)) {
      status.textContent = serverMode && error instanceof Error ? error.message : "후보 찾기를 시작하지 못했습니다. 원본 제출 이력 탭을 확인해 주세요.";
      scan.disabled = false; policy.disabled = false; platformSelect.disabled = false;
    } }
  });
  cancel.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; try { await applyState(await send({ type: "LOCAL_HISTORY_CANCEL", platform: expected }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "중단 요청을 전달하지 못했습니다. 원본 탭을 확인해 주세요."; cancel.disabled = false; } } });
  policy.addEventListener("change", () => { selected = new Set(selectHistoricalSubmissionIds(candidates.filter(allowedForRecovery), policy.value as HistoricalSelectionMode)); render(); });
  platformSelect.addEventListener("change", () => { platformEpoch += 1; showPlatform(); void loadTiming(); void loadPlatform(); });
  importButton.addEventListener("click", async () => {
    const expected = platform(), epoch = platformEpoch;
    if (!readyForImport || importButton.disabled) return;
    const chosen = selectedInCandidateOrder(); readyForImport = false;
    importButton.disabled = true; scan.disabled = true; policy.disabled = true; platformSelect.disabled = true;
    notifyCollection(null);
    try {
      if (serverMode) {
        if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return;
        registrationSelection = new Set(chosen.filter(id => !existing(id))); registrationAccount = serverAccount;
        serverError = ''; registrationRunId = crypto.randomUUID();
        if (!registrationSelection.size) {
          status.textContent = '선택한 제출은 이미 서버에 등록되어 있습니다.'; readyForImport = true; render();
          scan.disabled = false; policy.disabled = false; platformSelect.disabled = false; return;
        }
      }
      await applyState(await send({ type: "LOCAL_HISTORY_IMPORT_START", platform: expected, submissionIds: serverMode ? [...registrationSelection!] : chosen, ...(serverMode ? { serverRunId: registrationRunId, serverAccount: registrationAccount } : {}) }), expected, epoch);
    } catch (error) { if (ownsPlatform(expected, epoch)) {
      status.textContent = serverMode && error instanceof Error ? error.message : "저장을 시작하지 못했습니다. 다시 시도해 주세요.";
      readyForImport = true; scan.disabled = false; policy.disabled = false; platformSelect.disabled = false; render();
    } }
  });
  showPlatform(); void loadTiming(); void loadPlatform();
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const serverMode = params.get('embedded') === '1' && params.get('server') === '1' && window.parent !== window;
  if (params.get('embedded') === '1' && window.parent !== window && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => window.parent.postMessage({ type: 'CODEARCHIVE_HISTORY_HEIGHT', height: Math.ceil(document.querySelector('main')!.getBoundingClientRect().height) + 8 }, window.location.origin)).observe(document.querySelector('main')!);
  }
  const server = serverMode ? (operation: 'IDS', platform: HistoryServerPlatform, account?: string, capture?: unknown): Promise<HistoryServerResult> => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('서버 응답이 늦어지고 있습니다. 다시 시도하면 서버 기록부터 확인합니다.')); }, 60_000);
    function receive(event: MessageEvent) {
      if (event.source !== window.parent || event.origin !== window.location.origin || !event.data || event.data.type !== 'CODEARCHIVE_HISTORY_SERVER_RESPONSE' || event.data.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (typeof event.data.error === 'string') reject(new Error(event.data.error)); else resolve(event.data.result);
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'CODEARCHIVE_HISTORY_SERVER_REQUEST', requestId, operation, platform, account, capture }, window.location.origin);
  }) : undefined;
  if (new URLSearchParams(window.location.search).get('embedded') === '1') document.body.classList.add('embedded-history');
  if (params.get('embedded') !== '1') window.location.replace('dashboard.html?view=history');
  else mountHistory(document, {
  send: message => chrome.runtime.sendMessage(message) as Promise<unknown>,
  server,
  readTiming: () => chrome.storage.local.get(HISTORY_TIMING_STORAGE_KEY),
  subscribeCollectionRequest: publish => {
    window.addEventListener('message', event => {
      if (window.parent !== window && new URLSearchParams(window.location.search).get('embedded') === '1' &&
          isTrustedHistoricalCollectionRequest(event, window.parent, window.location.origin)) publish();
    });
  },
  onCollectionNotice: notice => {
    if (window.parent !== window && new URLSearchParams(window.location.search).get('embedded') === '1') window.parent.postMessage(notice, window.location.origin);
  }
  });
}
