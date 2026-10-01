import { selectHistoricalSubmissionIds, type HistoricalSelectionMode } from "../../../shared/historicalSelection";

type Platform = "JUNGOL" | "SWEA" | "PROGRAMMERS";
type Candidate = { submissionId: string; problemNumber: string; title: string; language?: string; executionTime?: number; memoryValue?: number };
type State = { status: string; candidates?: Candidate[]; truncated?: boolean; progress?: { phase: string; rows: number; pagesLoaded: number; groupsExpanded: number; groupsTotal: number }; completed?: number; total?: number; saved?: number; duplicate?: number };
export type HistoryServices = { send: (message: unknown) => Promise<unknown>; schedule?: (work: () => void, delay: number) => unknown };

const platformInfo: Record<Platform, { href: string; description: string; unsupported?: string }> = {
  JUNGOL: { href: "https://jungol.co.kr/submission", description: "정올의 내 제출 필터를 켠 탭을 열어 둔 상태에서 이 브라우저에만 저장합니다. 수집 중에는 원본 탭을 닫거나 이동하지 마세요." },
  SWEA: { href: "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do", description: "SWEA 해결 내역을 열어 볼 수 있습니다.", unsupported: "SWEA 원본 코드 일괄 수집은 아직 지원하지 않습니다." },
  PROGRAMMERS: { href: "https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1", description: "프로그래머스 해결 내역을 열어 볼 수 있습니다.", unsupported: "프로그래머스 원본 코드 일괄 수집은 아직 지원하지 않습니다." }
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
  const candidatesPanel = doc.querySelector<HTMLElement>("#candidates")!;
  const list = doc.querySelector<HTMLElement>("#candidate-list")!;
  const help = doc.querySelector<HTMLElement>("#candidate-help")!;
  let candidates: Candidate[] = [], localIds = new Set<string>(), selected = new Set<string>();
  let pollingEpoch: number | null = null, readyForImport = false, platformEpoch = 0;
  const platform = (): Platform => platformSelect.value as Platform;
  const isJungol = () => platform() === "JUNGOL";
  const validState = (value: unknown): State | null => value && typeof value === "object" && typeof (value as State).status === "string" ? value as State : null;
  function label(state: State) {
    if (state.status === "SCANNING") return "목록을 확인하고 있어요.";
    if (state.status === "IMPORTING") return `로컬 저장 중 ${state.completed ?? 0}/${state.total ?? 0}건`;
    if (state.status === "CANCELLING") return `현재 제출 처리를 마무리하는 중입니다. ${state.completed ?? 0}/${state.total ?? 0}건 처리했습니다.`;
    if (state.status === "DONE") return `로컬 저장 완료 · 신규 ${state.saved ?? 0}건 · 이미 저장됨 ${state.duplicate ?? 0}건`;
    if (state.status === "TAB_NOT_FOUND") return "정올의 내 제출 탭을 하나 열어 주세요.";
    if (state.status === "MULTIPLE_TABS") return "정올 제출 탭이 여러 개입니다. 하나만 남긴 뒤 다시 시도해 주세요.";
    if (state.status === "INTERRUPTED") return "원본 탭이 닫혔거나 이동했습니다. 저장된 항목은 유지됩니다.";
    if (state.status === "SCAN_INCOMPLETE") return "목록이 끝까지 열리지 않았습니다. 원본 탭을 유지한 뒤 다시 시도해 주세요.";
    if (state.status === "FAILED") return "수집을 완료하지 못했습니다. 원본 탭 상태를 확인해 주세요.";
    return state.status === "READY" ? "후보 목록을 확인했습니다." : "원본 정올 제출 탭을 확인하세요.";
  }
  function clearCandidates() { candidates = []; selected.clear(); readyForImport = false; candidatesPanel.hidden = true; list.replaceChildren(); }
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
    help.textContent = selected.size > 5_000 ? "한 번에 최대 5,000개 제출을 저장할 수 있습니다. 선택 범위를 줄여 주세요." : localIds.size ? `이미 이 브라우저에 저장한 제출 ${localIds.size}건은 후보에서 제외했습니다.` : "";
    importButton.textContent = `선택한 ${selected.size}건 로컬 저장`; importButton.disabled = !isJungol() || !readyForImport || selected.size === 0 || selected.size > 5_000;
  }
  function showPlatform() {
    const current = platform(), info = platformInfo[current];
    siteLink.href = info.href; description.textContent = info.description; platformHelp.textContent = info.unsupported ?? "정올은 내 제출 필터를 켠 뒤 후보를 확인할 수 있습니다.";
    clearCandidates(); progressBar.hidden = true; progress.textContent = ""; cancel.hidden = true; policy.disabled = false; platformSelect.disabled = false;
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
  async function applyState(value: unknown, expected: Platform = platform(), epoch = platformEpoch) {
    if (!ownsPlatform(expected, epoch)) return;
    const state = validState(value); if (!state) { status.textContent = "확장 프로그램 응답을 확인할 수 없습니다."; return; }
    const active = state.status === "SCANNING" || state.status === "IMPORTING" || state.status === "CANCELLING";
    status.textContent = label(state); scan.disabled = active; policy.disabled = active; platformSelect.disabled = active; cancel.hidden = !active; cancel.disabled = state.status === "CANCELLING";
    if (state.progress) { progressBar.hidden = false; progressBar.removeAttribute("value"); progressBar.removeAttribute("max"); progress.textContent = state.progress.phase === "pages" ? `목록 행 ${state.progress.rows}개를 확인 중입니다.` : `그룹 ${state.progress.groupsExpanded}/${state.progress.groupsTotal}개를 확인 중입니다.`; }
    else if (state.status === "IMPORTING" || state.status === "CANCELLING") { progressBar.hidden = false; progressBar.max = Math.max(1, state.total ?? 1); progressBar.value = state.completed ?? 0; progress.textContent = `${state.completed ?? 0}/${state.total ?? 0}건 처리했습니다.`; }
    else { progressBar.hidden = true; progress.textContent = ""; }
    if (state.status === "READY" && !state.truncated && Array.isArray(state.candidates)) {
      candidates = state.candidates.filter(item => typeof item.submissionId === "string" && /^\d{1,40}$/.test(item.submissionId)); selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), policy.value as HistoricalSelectionMode)); readyForImport = true; candidatesPanel.hidden = false; render();
    } else if (state.status !== "READY") {
      readyForImport = false; if (state.status !== "SCANNING") clearCandidates();
      if (state.status === "DONE" || state.status === "FAILED" || state.status === "INTERRUPTED") void refreshLocalIds(expected, epoch).then(ok => { if (ok) render(); }).catch(() => undefined);
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
  scan.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL") return; try { if (!await refreshLocalIds(expected, epoch) || !ownsPlatform(expected, epoch)) return; clearCandidates(); render(); await applyState(await send({ type: "LOCAL_HISTORY_SCAN_START" }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "후보 찾기를 시작하지 못했습니다. 원본 정올 제출 탭을 확인해 주세요."; scan.disabled = false; } } });
  cancel.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL") return; try { await applyState(await send({ type: "LOCAL_HISTORY_CANCEL" }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "중단 요청을 전달하지 못했습니다. 원본 정올 탭을 확인해 주세요."; cancel.disabled = false; } } });
  policy.addEventListener("change", () => { if (!isJungol()) return; selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), policy.value as HistoricalSelectionMode)); render(); });
  platformSelect.addEventListener("change", () => { platformEpoch += 1; showPlatform(); if (isJungol()) void loadJungol(); });
  importButton.addEventListener("click", async () => { const expected = platform(), epoch = platformEpoch; if (expected !== "JUNGOL" || !readyForImport) return; try { await applyState(await send({ type: "LOCAL_HISTORY_IMPORT_START", submissionIds: [...selected] }), expected, epoch); } catch { if (ownsPlatform(expected, epoch)) { status.textContent = "로컬 저장을 시작하지 못했습니다. 다시 시도해 주세요."; render(); } } });
  showPlatform(); if (isJungol()) void loadJungol();
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") mountHistory(document, { send: message => chrome.runtime.sendMessage(message) as Promise<unknown> });
