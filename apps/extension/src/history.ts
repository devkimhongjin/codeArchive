import { selectHistoricalSubmissionIds, type HistoricalSelectionMode } from "../../../shared/historicalSelection";

type Candidate = { submissionId: string; problemNumber: string; title: string; language?: string; executionTime?: number; memoryValue?: number };
type State = { status: string; candidates?: Candidate[]; skipped?: number; truncated?: boolean; progress?: { phase: string; rows: number; pagesLoaded: number; groupsExpanded: number; groupsTotal: number }; completed?: number; total?: number; saved?: number; duplicate?: number; };
export type HistoryServices = { send: (message: unknown) => Promise<unknown>; schedule?: (work: () => void, delay: number) => unknown };
export function mountHistory(doc: Document, services: HistoryServices) {
const send = services.send;
const scan = doc.querySelector<HTMLButtonElement>("#scan")!;
const cancel = doc.querySelector<HTMLButtonElement>("#cancel")!;
const importButton = doc.querySelector<HTMLButtonElement>("#import")!;
const select = doc.querySelector<HTMLSelectElement>("#selection")!;
const status = doc.querySelector<HTMLElement>("#status")!;
const progress = doc.querySelector<HTMLElement>("#progress")!;
const progressBar = doc.querySelector<HTMLProgressElement>("#task-progress")!;
const candidatesPanel = doc.querySelector<HTMLElement>("#candidates")!;
const list = doc.querySelector<HTMLElement>("#candidate-list")!;
const help = doc.querySelector<HTMLElement>("#candidate-help")!;
let candidates: Candidate[] = [];
let localIds = new Set<string>();
let selected = new Set<string>();
let polling = false;
let readyForImport = false;

function validState(value: unknown): State | null { return value && typeof value === "object" && typeof (value as State).status === "string" ? value as State : null; }
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
function render() {
  const mode = select.value as HistoricalSelectionMode;
  const allowed = candidates.filter(item => !localIds.has(item.submissionId));
  selected = new Set([...selected].filter(id => allowed.some(item => item.submissionId === id)));
  list.replaceChildren();
  for (const candidate of allowed) {
    const row = doc.createElement("label"); row.className = "row";
    const checkbox = doc.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(candidate.submissionId);
    checkbox.setAttribute("aria-label", `제출 #${candidate.submissionId}`);
    checkbox.addEventListener("change", () => { checkbox.checked ? selected.add(candidate.submissionId) : selected.delete(candidate.submissionId); render(); });
    const title = doc.createElement("span"); title.textContent = `#${candidate.problemNumber} · ${candidate.title}`;
    const meta = doc.createElement("small"); meta.className = "meta"; meta.textContent = `제출 #${candidate.submissionId}${candidate.executionTime !== undefined ? ` · ${candidate.executionTime}ms` : ""}${candidate.memoryValue !== undefined ? ` · ${candidate.memoryValue}MB` : ""}`;
    row.append(checkbox, title, meta); list.append(row);
  }
  help.textContent = selected.size > 5_000
    ? "한 번에 최대 5,000개 제출을 저장할 수 있습니다. 선택 범위를 줄여 주세요."
    : localIds.size ? `이미 이 브라우저에 저장한 제출 ${localIds.size}건은 후보에서 제외했습니다.` : "";
  importButton.textContent = `선택한 ${selected.size}건 로컬 저장`; importButton.disabled = !readyForImport || selected.size === 0 || selected.size > 5_000;
}
async function applyState(value: unknown) {
  const state = validState(value); if (!state) { status.textContent = "확장 프로그램 응답을 확인할 수 없습니다."; return; }
  const active = state.status === "SCANNING" || state.status === "IMPORTING" || state.status === "CANCELLING";
  status.textContent = label(state); scan.disabled = active; select.disabled = active; cancel.hidden = !active; cancel.disabled = state.status === "CANCELLING";
  if (state.progress) { progressBar.hidden = false; progressBar.removeAttribute("value"); progressBar.removeAttribute("max"); progress.textContent = state.progress.phase === "pages" ? `목록 행 ${state.progress.rows}개를 확인 중입니다.` : `그룹 ${state.progress.groupsExpanded}/${state.progress.groupsTotal}개를 확인 중입니다.`; }
  else if (state.status === "IMPORTING" || state.status === "CANCELLING") { progressBar.hidden = false; progressBar.max = Math.max(1, state.total ?? 1); progressBar.value = state.completed ?? 0; progress.textContent = `${state.completed ?? 0}/${state.total ?? 0}건 처리했습니다.`; }
  else { progressBar.hidden = true; progress.textContent = ""; }
  if (state.status === "READY" && !state.truncated && Array.isArray(state.candidates)) { candidates = state.candidates.filter(item => typeof item.submissionId === "string" && /^\d{1,40}$/.test(item.submissionId)); selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), select.value as HistoricalSelectionMode)); readyForImport = true; candidatesPanel.hidden = false; render(); }
  else if (state.status !== "READY") {
    readyForImport = false;
    if (state.status !== "SCANNING") { candidates = []; selected.clear(); candidatesPanel.hidden = true; }
    if (state.status === "DONE" || state.status === "FAILED" || state.status === "INTERRUPTED") void refreshLocalIds().then(render).catch(() => undefined);
    render();
  }
  if (state.status === "SCANNING" || state.status === "IMPORTING" || state.status === "CANCELLING") poll();
}
async function poll() { if (polling) return; polling = true; (services.schedule ?? ((work, delay) => setTimeout(work, delay)))(async () => { polling = false; try { await applyState(await send({ type: "LOCAL_HISTORY_STATUS" })); } catch { status.textContent = "현재 수집 상태를 확인하지 못했습니다. 새로고침하거나 다시 확인해 주세요."; scan.disabled = false; select.disabled = false; } }, 500); }
async function refreshLocalIds() { const ids = (await send({ type: "LOCAL_HISTORY_IDS" })) as { submissionIds?: unknown }; localIds = new Set(Array.isArray(ids.submissionIds) ? ids.submissionIds.filter(id => typeof id === "string" && /^\d{1,40}$/.test(id)) : []); }
scan.addEventListener("click", async () => {
  try {
    await refreshLocalIds(); candidates = []; selected.clear(); readyForImport = false; candidatesPanel.hidden = true; render();
    await applyState(await send({ type: "LOCAL_HISTORY_SCAN_START" }));
  } catch { status.textContent = "후보 찾기를 시작하지 못했습니다. 원본 정올 제출 탭을 확인해 주세요."; scan.disabled = false; }
});
cancel.addEventListener("click", async () => { try { await applyState(await send({ type: "LOCAL_HISTORY_CANCEL" })); } catch { status.textContent = "중단 요청을 전달하지 못했습니다. 원본 정올 탭을 확인해 주세요."; cancel.disabled = false; } });
select.addEventListener("change", () => { selected = new Set(selectHistoricalSubmissionIds(candidates.filter(item => !localIds.has(item.submissionId)), select.value as HistoricalSelectionMode)); render(); });
importButton.addEventListener("click", async () => { if (!readyForImport) return; try { await applyState(await send({ type: "LOCAL_HISTORY_IMPORT_START", submissionIds: [...selected] })); } catch { status.textContent = "로컬 저장을 시작하지 못했습니다. 다시 시도해 주세요."; render(); } });
void refreshLocalIds().then(() => send({ type: "LOCAL_HISTORY_STATUS" })).then(applyState).catch(() => { status.textContent = "확장 프로그램에 연결할 수 없습니다."; });
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") {
  mountHistory(document, { send: message => chrome.runtime.sendMessage(message) as Promise<unknown> });
}
