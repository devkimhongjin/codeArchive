import { selectHistoricalSubmissionIds, type HistoricalSelectionMode } from "../../../shared/historicalSelection";
import { HISTORY_TIMING_STORAGE_KEY, estimateHistoricalTotalDuration, readHistoricalTimingSample, type HistoricalTimingSample } from "./historyTiming";

type Platform = "JUNGOL" | "SWEA" | "PROGRAMMERS";
type Candidate = { submissionId: string; problemNumber: string; title: string; language?: string; createdAt?: string; executionTime?: number; memoryValue?: number };
type State = { status: string; candidates?: Candidate[]; truncated?: boolean; progress?: {
  phase: string; stage?: string; rows: number; pagesLoaded: number; groupsExpanded: number; groupsTotal: number; groupsTotalKnown?: boolean;
  historiesRead?: number; historiesTotal?: number; currentProblemNumber?: string;
  lastProgressAt?: number; sourceVisibility?: "visible" | "hidden" | "prerender" | "unknown";
}; completed?: number; total?: number; saved?: number; duplicate?: number;
  startedAt?: number; endedAt?: number; lastProgressAt?: number; timingSample?: unknown;
  failureReason?: string; failurePage?: number; failedProblemNumber?: string;
  skipped?: number; failedSubmissionIds?: string[];
  problemCount?: number; submissionCount?: number; unsupportedProblemNumbers?: string[] };
export type HistoryServices = { send: (message: unknown) => Promise<unknown>;
  schedule?: (work: () => void, delay: number) => unknown; now?: () => number;
  readTiming?: () => Promise<unknown>; openSite?: (url: string) => Promise<unknown> };

const platformInfo: Record<Platform, { href: string; linkLabel: string; description: string; guide: string }> = {
  JUNGOL: { href: "https://jungol.co.kr/", linkLabel: "정올 열기 ↗", description: "정올에서 제출 내역을 연 뒤 이 브라우저에 로컬로 저장할 수 있습니다.", guide: "우측 상단 프로필 → 내 정보 → 제출현황에서 내 제출 내역을 열어 주세요." },
  SWEA: { href: "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do", linkLabel: "SWEA 해결 내역 열기 ↗", description: "SWEA에서 본인 제출 이력을 확인해 로컬에 저장할 수 있습니다.", guide: "My Page Code에서 제출한 Problem을 열어 주세요." },
  PROGRAMMERS: { href: "https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1", linkLabel: "프로그래머스 해결 내역 열기 ↗", description: "프로그래머스에서 해결 이력을 확인해 로컬에 저장할 수 있습니다.", guide: "해결한 문제 목록을 열어 두고 후보 찾기를 눌러 주세요." }
};

export function mountHistory(doc: Document, services: HistoryServices) {
  const send = services.send;
  const scan = doc.querySelector<HTMLButtonElement>("#scan")!;
  const cancel = doc.querySelector<HTMLButtonElement>("#cancel")!;
  const importButton = doc.querySelector<HTMLButtonElement>("#import")!;
  const policy = doc.querySelector<HTMLSelectElement>("#selection")!;
  const platformSelect = doc.querySelector<HTMLSelectElement>("#platform")!;
  const siteLink = doc.querySelector<HTMLAnchorElement>("#history-page-link")!;
  const description = doc.querySelector<HTMLElement>("#platform-description")!;
  const platformHelp = doc.querySelector<HTMLElement>("#platform-help")!;
  const status = doc.querySelector<HTMLElement>("#status")!;
  const progress = doc.querySelector<HTMLElement>("#progress")!;
  const progressBar = doc.querySelector<HTMLProgressElement>("#task-progress")!;
  const taskStage = doc.querySelector<HTMLElement>("#task-stage");
  const taskTime = doc.querySelector<HTMLElement>("#task-time");
  const now = services.now ?? (() => Date.now());
  const candidatesPanel = doc.querySelector<HTMLElement>("#candidates")!;
  const list = doc.querySelector<HTMLElement>("#candidate-list")!;
  const help = doc.querySelector<HTMLElement>("#candidate-help")!;
  let candidates: Candidate[] = [], localIds = new Set<string>(), selected = new Set<string>();
  let pollingEpoch: number | null = null, readyForImport = false, platformEpoch = 0, taskActive = false;
  let timingSample: HistoricalTimingSample | null = null;
  const platform = (): Platform => platformSelect.value as Platform;
  const validState = (value: unknown): State | null => value && typeof value === "object" && typeof (value as State).status === "string" ? value as State : null;
  function label(state: State) {
    const unsupportedNotice = state.unsupportedProblemNumbers?.length
      ? ` 제출 이력을 제공하지 않는 SQL 문제 ${state.unsupportedProblemNumbers.length}건은 수집 대상에서 제외했습니다.` : "";
    if (state.status === "SCANNING") return "목록을 확인하고 있어요.";
    if (state.status === "IMPORTING") return `로컬 저장 중 ${state.completed ?? 0}/${state.total ?? 0}건`;
    if (state.status === "CANCELLING") return `현재 제출 처리를 마무리하는 중입니다. ${state.completed ?? 0}/${state.total ?? 0}건 처리했습니다.`;
    const resultSummary = () => {
      const submissions = typeof state.submissionCount === "number" ? state.submissionCount : (state.saved ?? 0) + (state.duplicate ?? 0);
      const problems = typeof state.problemCount === "number" ? `문제 ${state.problemCount}건 · ` : "";
      const failures = state.skipped ? ` · 확인 실패 ${state.skipped}건${state.failedSubmissionIds?.length ? ` (제출 ${state.failedSubmissionIds.map(id => `#${id}`).join(", ")})` : ""}` : "";
      return `${problems}제출 ${submissions}건 · 새로 저장 ${state.saved ?? 0}건 · 이미 저장됨 ${state.duplicate ?? 0}건${failures}`;
    };
    if (state.status === "DONE") return `로컬 저장 완료 · ${resultSummary()}${unsupportedNotice}`;
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
    if (state.status === "TAB_NOT_FOUND") return platform() === "JUNGOL" ? "정올 우측 상단 프로필 → 내 정보 → 제출현황을 연 뒤 후보 찾기를 다시 눌러 주세요." : `${platformInfo[platform()].guide} 후보 찾기를 다시 눌러 주세요.`;
    if (state.status === "CONNECTION_REQUIRED") return platform() === "JUNGOL" ? "정올 제출현황을 열고 후보 찾기를 다시 눌러 주세요. 수집 연결을 복구합니다." : `${platformInfo[platform()].guide} 후보 찾기를 다시 눌러 주세요.`;
    if (state.status === "CONNECTION_FAILED") return platform() === "JUNGOL" ? "정올 탭과 연결하지 못했습니다. 제출현황을 새로고침한 뒤 후보 찾기를 다시 눌러 주세요." : `${platformInfo[platform()].guide} 새로고침한 뒤 다시 눌러 주세요.`;
    if (state.status === "MULTIPLE_TABS") return platform() === "JUNGOL" ? "정올 제출 탭이 여러 개입니다. 하나만 남긴 뒤 다시 시도해 주세요." : `${platformInfo[platform()].guide} 탭을 하나만 남긴 뒤 다시 눌러 주세요.`;
    if (state.status === "INTERRUPTED") return "원본 탭이 닫혔거나 이동했습니다. 저장된 항목은 유지됩니다.";
    if (state.status === "OWNERSHIP_UNVERIFIED" || state.status === "LOGIN_REQUIRED") return "로그인한 본인의 제출 이력을 확인하지 못했습니다. 원본 사이트의 로그인 상태를 확인해 주세요.";
    if (state.status === "SCAN_INCOMPLETE" && state.failurePage) {
      const where = state.failedProblemNumber ? `문제 #${state.failedProblemNumber}의 제출 이력 ${state.failurePage}페이지` : `문제 목록 ${state.failurePage}페이지`;
      return `${where}를 확인하지 못해 후보 찾기를 중단했습니다. 원본 사이트에서 해당 목록을 확인한 뒤 다시 시도해 주세요.`;
    }
    if (state.status === "SCAN_INCOMPLETE") return "목록이 끝까지 열리지 않았습니다. 원본 탭을 유지한 뒤 다시 시도해 주세요.";
    if (state.status === "FAILED") return "수집을 완료하지 못했습니다. 원본 탭 상태를 확인해 주세요.";
    return state.status === "READY" ? `후보 목록을 확인했습니다.${unsupportedNotice}` : platformInfo[platform()].guide;
  }
  function clearCandidates() { candidates = []; selected.clear(); readyForImport = false; candidatesPanel.hidden = true; list.replaceChildren(); }
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
    return candidates.filter(item => !localIds.has(item.submissionId) && selected.has(item.submissionId)).map(item => item.submissionId);
  }
  function render() {
    const allowed = candidates.filter(item => !localIds.has(item.submissionId));
    selected = new Set([...selected].filter(id => allowed.some(item => item.submissionId === id)));
    list.replaceChildren();
    for (const candidate of allowed) {
      const row = doc.createElement("label"); row.className = "row";
      const checkbox = doc.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(candidate.submissionId); checkbox.setAttribute("aria-label", `제출 #${candidate.submissionId}`);
      checkbox.addEventListener("change", () => { checkbox.checked ? selected.add(candidate.submissionId) : selected.delete(candidate.submissionId); render(); });
      const title = doc.createElement("span"); title.textContent = `#${candidate.problemNumber} · ${candidate.title}`;
      const meta = doc.createElement("small"); meta.className = "meta";
      meta.textContent = platform() === "PROGRAMMERS"
        ? `${candidate.createdAt ?? "제출 시각 확인됨"}${candidate.language ? ` · ${candidate.language}` : ""}`
        : `제출 #${candidate.submissionId}${candidate.executionTime !== undefined ? ` · ${candidate.executionTime}ms` : ""}${candidate.memoryValue !== undefined ? ` · ${candidate.memoryValue}${platform() === "SWEA" ? "KB" : "MB"}` : ""}`;
      row.append(checkbox, title, meta); list.append(row);
    }
    const problemCount = new Set(allowed.map(item => `${platform()}:${item.problemNumber}`)).size;
    const summary = `후보 문제 ${problemCount}건 · 제출 ${allowed.length}건`;
    const excluded = candidates.length - allowed.length;
    help.textContent = selected.size > 5_000 ? `${summary} · 한 번에 최대 5,000개 제출을 저장할 수 있습니다. 선택 범위를 줄여 주세요.` :
      excluded ? `${summary} · 이미 이 브라우저에 저장한 제출 ${excluded}건은 후보에서 제외했습니다.` : summary;
    importButton.textContent = `선택한 ${selected.size}건 로컬 저장`;
    importButton.disabled = taskActive || !readyForImport || selected.size === 0 || selected.size > 5_000;
  }
  function showPlatform() {
    const current = platform(), info = platformInfo[current];
    siteLink.href = info.href; siteLink.textContent = info.linkLabel; description.textContent = info.description; platformHelp.textContent = info.guide;
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
    const ids = (await send({ type: "LOCAL_HISTORY_IDS", platform: expected })) as { submissionIds?: unknown };
    if (!ownsPlatform(expected, epoch)) return false;
    localIds = new Set(Array.isArray(ids.submissionIds) ? ids.submissionIds.filter(id => typeof id === "string" && id.length <= 300) : []); return true;
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
    const active = state.status === "SCANNING" || state.status === "IMPORTING" || state.status === "CANCELLING";
    taskActive = active;
    const stateSample = readHistoricalTimingSample(state.timingSample);
    if (stateSample) timingSample = stateSample;
    status.textContent = label(state); scan.disabled = active; policy.disabled = active; platformSelect.disabled = active; cancel.hidden = !active; cancel.disabled = state.status === "CANCELLING";
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
        state.status === "IMPORTING" ? "제출을 확인하고 로컬에 저장하는 중입니다." : "";
    } else { progressBar.hidden = true; progress.textContent = ""; if (taskStage) taskStage.textContent = ""; }
    if (state.status === "READY" && !state.truncated && Array.isArray(state.candidates)) {
      candidates = state.candidates.filter(item => typeof item.submissionId === "string" && item.submissionId.length > 0 && item.submissionId.length <= 300); selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), policy.value as HistoricalSelectionMode)); readyForImport = true; candidatesPanel.hidden = false; render();
    } else if (state.status !== "READY") {
      readyForImport = false; if (state.status !== "SCANNING") clearCandidates();
      if (state.status === "DONE" || state.status === "FAILED" || state.status === "INTERRUPTED") {
        void refreshLocalIds(expected, epoch).then(ok => { if (ok) render(); }).catch(() => undefined);
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
  async function loadPlatform() { const expected = platform(), epoch = platformEpoch; try { if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return; await applyState(await send({ type: "LOCAL_HISTORY_STATUS", platform: expected }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) status.textContent = "확장 프로그램에 연결할 수 없습니다."; } }
  siteLink.addEventListener("click", async event => {
    if (!services.openSite || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const current = platform(), epoch = platformEpoch;
    try { await services.openSite(platformInfo[current].href); }
    catch { if (platform() === current && platformEpoch === epoch) status.textContent = "사이트를 새 창에서 열지 못했습니다. 다시 눌러 주세요."; }
  });
  scan.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; try { if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return; clearCandidates(); render(); await applyState(await send({ type: "LOCAL_HISTORY_SCAN_START", platform: expected }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "후보 찾기를 시작하지 못했습니다. 원본 제출 이력 탭을 확인해 주세요."; scan.disabled = false; } } });
  cancel.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; try { await applyState(await send({ type: "LOCAL_HISTORY_CANCEL", platform: expected }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "중단 요청을 전달하지 못했습니다. 원본 탭을 확인해 주세요."; cancel.disabled = false; } } });
  policy.addEventListener("change", () => { selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), policy.value as HistoricalSelectionMode)); render(); });
  platformSelect.addEventListener("change", () => { platformEpoch += 1; showPlatform(); void loadTiming(); void loadPlatform(); });
  importButton.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (!readyForImport) return; try { await applyState(await send({ type: "LOCAL_HISTORY_IMPORT_START", platform: expected, submissionIds: selectedInCandidateOrder() }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "로컬 저장을 시작하지 못했습니다. 다시 시도해 주세요."; render(); } } });
  showPlatform(); void loadTiming(); void loadPlatform();
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") mountHistory(document, {
  send: message => chrome.runtime.sendMessage(message) as Promise<unknown>,
  readTiming: () => chrome.storage.local.get(HISTORY_TIMING_STORAGE_KEY),
  openSite: url => chrome.windows.create({ url, type: "normal", focused: true })
});
