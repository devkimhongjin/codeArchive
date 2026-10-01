import { selectHistoricalSubmissionIds, type HistoricalSelectionMode } from "../../../shared/historicalSelection";
import { HISTORY_TIMING_STORAGE_KEY, estimateHistoricalDuration, estimateHistoricalTotalDuration, readHistoricalTimingSample, type HistoricalTimingSample } from "./historyTiming";

type Platform = "JUNGOL" | "SWEA" | "PROGRAMMERS";
type Candidate = { submissionId: string; problemNumber: string; title: string; language?: string; executionTime?: number; memoryValue?: number };
type State = { status: string; candidates?: Candidate[]; truncated?: boolean; progress?: {
  phase: string; stage?: string; rows: number; pagesLoaded: number; groupsExpanded: number; groupsTotal: number; groupsTotalKnown?: boolean;
  lastProgressAt?: number; sourceVisibility?: "visible" | "hidden" | "prerender" | "unknown";
}; completed?: number; total?: number; saved?: number; duplicate?: number;
  startedAt?: number; endedAt?: number; lastProgressAt?: number; timingSample?: unknown;
  problemCount?: number; submissionCount?: number };
export type HistoryServices = { send: (message: unknown) => Promise<unknown>;
  schedule?: (work: () => void, delay: number) => unknown; now?: () => number;
  readTiming?: () => Promise<unknown>; openSite?: (url: string) => Promise<unknown> };

const platformInfo: Record<Platform, { href: string; linkLabel: string; description: string; guide: string; unsupported?: string }> = {
  JUNGOL: { href: "https://jungol.co.kr/", linkLabel: "정올 열기 ↗", description: "정올에서 제출 내역을 연 뒤 이 브라우저에 로컬로 저장할 수 있습니다.", guide: "우측 상단 프로필 → 내 정보 → 제출현황에서 내 제출 내역을 열어 주세요." },
  SWEA: { href: "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do", linkLabel: "SWEA 해결 내역 열기 ↗", description: "SWEA 해결 내역을 열어 볼 수 있습니다.", guide: "사이트에서 해결 내역을 확인할 수 있습니다.", unsupported: "SWEA 원본 코드 일괄 수집은 아직 지원하지 않습니다." },
  PROGRAMMERS: { href: "https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1", linkLabel: "프로그래머스 해결 내역 열기 ↗", description: "프로그래머스 해결 내역을 열어 볼 수 있습니다.", guide: "사이트에서 해결 내역을 확인할 수 있습니다.", unsupported: "프로그래머스 원본 코드 일괄 수집은 아직 지원하지 않습니다." }
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
  const timingEstimate = doc.querySelector<HTMLElement>("#timing-estimate");
  const now = services.now ?? (() => Date.now());
  const candidatesPanel = doc.querySelector<HTMLElement>("#candidates")!;
  const list = doc.querySelector<HTMLElement>("#candidate-list")!;
  const help = doc.querySelector<HTMLElement>("#candidate-help")!;
  let candidates: Candidate[] = [], localIds = new Set<string>(), selected = new Set<string>();
  let pollingEpoch: number | null = null, readyForImport = false, platformEpoch = 0, taskActive = false;
  let timingSample: HistoricalTimingSample | null = null;
  const platform = (): Platform => platformSelect.value as Platform;
  const isJungol = () => platform() === "JUNGOL";
  const validState = (value: unknown): State | null => value && typeof value === "object" && typeof (value as State).status === "string" ? value as State : null;
  function label(state: State) {
    if (state.status === "SCANNING") return "목록을 확인하고 있어요.";
    if (state.status === "IMPORTING") return `로컬 저장 중 ${state.completed ?? 0}/${state.total ?? 0}건`;
    if (state.status === "CANCELLING") return `현재 제출 처리를 마무리하는 중입니다. ${state.completed ?? 0}/${state.total ?? 0}건 처리했습니다.`;
    const resultSummary = () => {
      const submissions = typeof state.submissionCount === "number" ? state.submissionCount : (state.saved ?? 0) + (state.duplicate ?? 0);
      const problems = typeof state.problemCount === "number" ? `문제 ${state.problemCount}건 · ` : "";
      return `${problems}제출 ${submissions}건 · 새로 저장 ${state.saved ?? 0}건 · 이미 저장됨 ${state.duplicate ?? 0}건`;
    };
    if (state.status === "DONE") return `로컬 저장 완료 · ${resultSummary()}`;
    if (state.status === "INTERRUPTED" && (state.completed ?? 0) > 0) return `수집이 중단되었습니다. 현재까지 ${resultSummary()}`;
    if (state.status === "FAILED" && (state.completed ?? 0) > 0) return `수집을 완료하지 못했습니다. 현재까지 ${resultSummary()}`;
    if (state.status === "TAB_NOT_FOUND") return "정올의 내 제출 탭을 하나 열어 주세요.";
    if (state.status === "MULTIPLE_TABS") return "정올 제출 탭이 여러 개입니다. 하나만 남긴 뒤 다시 시도해 주세요.";
    if (state.status === "INTERRUPTED") return "원본 탭이 닫혔거나 이동했습니다. 저장된 항목은 유지됩니다.";
    if (state.status === "SCAN_INCOMPLETE") return "목록이 끝까지 열리지 않았습니다. 원본 탭을 유지한 뒤 다시 시도해 주세요.";
    if (state.status === "FAILED") return "수집을 완료하지 못했습니다. 원본 탭 상태를 확인해 주세요.";
    return state.status === "READY" ? "후보 목록을 확인했습니다." : "원본 정올 제출 탭을 확인하세요.";
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
  function renderEstimate(count: number) {
    if (!timingEstimate || !isJungol()) return;
    if (count < 1) { timingEstimate.hidden = true; timingEstimate.textContent = ""; return; }
    const estimate = estimateHistoricalDuration(timingSample, count);
    timingEstimate.hidden = false;
    timingEstimate.textContent = estimate === null ? "로컬 저장 예상: ?시간" :
      `로컬 저장 예상: ${formatElapsed(estimate)}`;
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
      const meta = doc.createElement("small"); meta.className = "meta"; meta.textContent = `제출 #${candidate.submissionId}${candidate.executionTime !== undefined ? ` · ${candidate.executionTime}ms` : ""}${candidate.memoryValue !== undefined ? ` · ${candidate.memoryValue}MB` : ""}`;
      row.append(checkbox, title, meta); list.append(row);
    }
    const problemCount = new Set(allowed.map(item => `JUNGOL:${item.problemNumber}`)).size;
    const summary = `후보 문제 ${problemCount}건 · 제출 ${allowed.length}건`;
    help.textContent = selected.size > 5_000 ? `${summary} · 한 번에 최대 5,000개 제출을 저장할 수 있습니다. 선택 범위를 줄여 주세요.` :
      localIds.size ? `${summary} · 이미 이 브라우저에 저장한 제출 ${localIds.size}건은 후보에서 제외했습니다.` : summary;
    importButton.textContent = `선택한 ${selected.size}건 로컬 저장`;
    importButton.disabled = !isJungol() || taskActive || !readyForImport || selected.size === 0 || selected.size > 5_000;
    if (!taskActive) renderEstimate(selected.size);
  }
  function showPlatform() {
    const current = platform(), info = platformInfo[current];
    siteLink.href = info.href; siteLink.textContent = info.linkLabel; description.textContent = info.description; platformHelp.textContent = info.guide;
    clearCandidates(); progressBar.hidden = true; progress.textContent = ""; if (taskStage) taskStage.textContent = ""; if (taskTime) { taskTime.textContent = ""; taskTime.hidden = true; }
    if (timingEstimate) { timingEstimate.textContent = ""; timingEstimate.hidden = true; }
    cancel.hidden = true; policy.disabled = false; platformSelect.disabled = false; taskActive = false;
    if (current === "JUNGOL") { scan.textContent = "정올 제출 후보 찾기"; scan.disabled = false; status.textContent = "원본 정올 제출 탭을 확인하세요."; }
    else { scan.textContent = "원본 코드 일괄 수집 준비 중"; scan.disabled = true; status.textContent = info.unsupported!; }
    render();
  }
  const ownsPlatform = (expected: Platform, epoch: number) => expected === "JUNGOL" && platform() === expected && epoch === platformEpoch;
  async function refreshLocalIds(expected: Platform = platform(), epoch = platformEpoch) {
    if (expected !== "JUNGOL") return false;
    const ids = (await send({ type: "LOCAL_HISTORY_IDS" })) as { submissionIds?: unknown };
    if (!ownsPlatform(expected, epoch)) return false;
    localIds = new Set(Array.isArray(ids.submissionIds) ? ids.submissionIds.filter(id => typeof id === "string" && /^\d{1,40}$/.test(id)) : []); return true;
  }
  async function loadTiming(expected: Platform = platform(), epoch = platformEpoch) {
    try {
      const value = await (services.readTiming ? services.readTiming() : chrome.storage.local.get(HISTORY_TIMING_STORAGE_KEY));
      if (!ownsPlatform(expected, epoch)) return;
      const record = value && typeof value === "object" && HISTORY_TIMING_STORAGE_KEY in value
        ? (value as Record<string, unknown>)[HISTORY_TIMING_STORAGE_KEY] : value;
      timingSample = readHistoricalTimingSample(record);
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
      const groupTotalKnown = scanProgress.phase === "groups" && scanProgress.groupsTotalKnown === true && scanProgress.groupsTotal > 0;
      if (groupTotalKnown) {
        progressBar.max = scanProgress.groupsTotal; progressBar.value = scanProgress.groupsExpanded;
      } else { progressBar.removeAttribute("value"); progressBar.removeAttribute("max"); }
      const waiting = scanProgress.stage === "waiting-pages" || scanProgress.stage === "waiting-groups";
      progress.textContent = scanProgress.phase === "pages"
        ? `목록 행 ${scanProgress.rows}개 · ${scanProgress.pagesLoaded}개 페이지를 확인했습니다.`
        : groupTotalKnown
          ? `그룹 ${scanProgress.groupsExpanded}/${scanProgress.groupsTotal}개를 확인했습니다.`
          : `그룹 ${scanProgress.groupsExpanded}개를 확인했습니다.`;
      if (taskStage) taskStage.textContent = waiting
        ? `${scanProgress.stage === "waiting-pages" ? "다음 목록 또는 마지막 목록" : "그룹 펼침"} 응답을 기다리는 중${scanProgress.sourceVisibility === "hidden" ? " · 원본 탭이 백그라운드 상태입니다." : "."}`
        : scanProgress.phase === "pages" ? "목록을 읽는 중입니다." : "그룹을 펼치는 중입니다.";
    } else if ((state.status === "IMPORTING" || state.status === "CANCELLING" || state.status === "DONE" || state.status === "FAILED" || state.status === "INTERRUPTED") &&
      typeof state.total === "number" && typeof state.completed === "number") {
      progressBar.hidden = false; progressBar.max = Math.max(1, state.total); progressBar.value = state.completed;
      const total = Math.max(0, state.total), completed = Math.max(0, state.completed);
      const percent = total ? Math.min(100, Math.floor(completed / total * 100)) : 0;
      progress.textContent = `${completed}/${total}건 처리했습니다. (${percent}%)`;
      if (taskStage) taskStage.textContent = state.status === "CANCELLING" ? "현재 제출 처리를 마무리하는 중입니다." :
        state.status === "IMPORTING" ? "제출을 확인하고 로컬에 저장하는 중입니다." : "처리된 제출 기준 진행률입니다.";
      if ((state.status === "IMPORTING" || state.status === "CANCELLING") && timingEstimate) {
        timingEstimate.hidden = true; timingEstimate.textContent = "";
      }
    } else { progressBar.hidden = true; progress.textContent = ""; if (taskStage) taskStage.textContent = ""; }
    if (state.status === "READY" && !state.truncated && Array.isArray(state.candidates)) {
      candidates = state.candidates.filter(item => typeof item.submissionId === "string" && /^\d{1,40}$/.test(item.submissionId)); selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), policy.value as HistoricalSelectionMode)); readyForImport = true; candidatesPanel.hidden = false; render();
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
      try { await applyState(await send({ type: "LOCAL_HISTORY_STATUS" }), expected, epoch); }
      catch { if (ownsPlatform(expected, epoch)) { status.textContent = "현재 수집 상태를 확인하지 못했습니다. 새로고침하거나 다시 확인해 주세요."; scan.disabled = false; policy.disabled = false; platformSelect.disabled = false; } }
    }, 500);
  }
  async function loadJungol() { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL") return; try { if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return; await applyState(await send({ type: "LOCAL_HISTORY_STATUS" }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) status.textContent = "확장 프로그램에 연결할 수 없습니다."; } }
  siteLink.addEventListener("click", async event => {
    if (!services.openSite || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const current = platform(), epoch = platformEpoch;
    try { await services.openSite(platformInfo[current].href); }
    catch { if (platform() === current && platformEpoch === epoch) status.textContent = "사이트를 새 창에서 열지 못했습니다. 다시 눌러 주세요."; }
  });
  scan.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL") return; try { if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return; clearCandidates(); render(); await applyState(await send({ type: "LOCAL_HISTORY_SCAN_START" }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "후보 찾기를 시작하지 못했습니다. 원본 정올 제출 탭을 확인해 주세요."; scan.disabled = false; } } });
  cancel.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL") return; try { await applyState(await send({ type: "LOCAL_HISTORY_CANCEL" }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "중단 요청을 전달하지 못했습니다. 원본 정올 탭을 확인해 주세요."; cancel.disabled = false; } } });
  policy.addEventListener("change", () => { if (!isJungol()) return; selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), policy.value as HistoricalSelectionMode)); render(); });
  platformSelect.addEventListener("change", () => { platformEpoch += 1; showPlatform(); if (isJungol()) { void loadTiming(); void loadJungol(); } });
  importButton.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL" || !readyForImport) return; try { await applyState(await send({ type: "LOCAL_HISTORY_IMPORT_START", submissionIds: selectedInCandidateOrder() }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "로컬 저장을 시작하지 못했습니다. 다시 시도해 주세요."; render(); } } });
  showPlatform(); if (isJungol()) { void loadTiming(); void loadJungol(); }
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") mountHistory(document, {
  send: message => chrome.runtime.sendMessage(message) as Promise<unknown>,
  readTiming: () => chrome.storage.local.get(HISTORY_TIMING_STORAGE_KEY),
  openSite: url => chrome.windows.create({ url, type: "normal", focused: true })
});
