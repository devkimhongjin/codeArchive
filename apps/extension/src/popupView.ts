import type { Capture } from "./types";
import type { GithubCommitStatus } from "./relay";
import { canonicalLanguageDisplayName } from "../../../shared/language";
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from "./capturePresentation";
import { buildLabel, updatedLabel } from "../../../shared/buildMetadata";

type CapturePreview = Omit<Capture, "sourceCode"> & { githubCommitStatus?: GithubCommitStatus };

interface PopupServices {
  load: () => Promise<unknown>;
  copy: (text: string) => Promise<void>;
  copyCapture?: (captureId: string) => Promise<{ ok?: boolean; text?: string }>;
  downloadCapture?: (captureId: string) => Promise<{ ok?: boolean }>;
  loadGithubStatuses?: (captureIds: string[]) => Promise<{ statuses?: Record<string, GithubCommitStatus> }>;
  updateSettings?: (patch: Record<string, boolean>) => Promise<unknown>;
}

function asDisplayCapture(value: unknown): CapturePreview | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Capture>;
  if (
    typeof candidate.captureId !== "string" ||
    typeof candidate.platform !== "string" ||
    (candidate.platform !== "SWEA" && candidate.platform !== "PROGRAMMERS") ||
    typeof candidate.problemNumber !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.problemUrl !== "string" ||
    typeof candidate.language !== "string" ||
    candidate.result !== "ACCEPTED" ||
    (candidate.syncState !== "PENDING" && candidate.syncState !== "SYNCED") ||
    typeof candidate.observedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.observedAt))
  ) {
    return null;
  }
  const githubCommitStatus = (value as { githubCommitStatus?: unknown }).githubCommitStatus;
  if (githubCommitStatus !== undefined && !["NOT_REQUESTED", "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(String(githubCommitStatus))) return null;
  return candidate as CapturePreview;
}

function appendCaptureTitle(document: Document, item: HTMLElement, capture: CapturePreview): void {
  const title = document.createElement("a");
  title.className = "recent-title";
  title.href = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capture.captureId)
    ? `archive.html#${encodeURIComponent(capture.captureId)}`
    : "archive.html";
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = `#${capture.problemNumber} · ${capture.title}`;
  item.append(title);
}

function renderRecent(document: Document, list: HTMLElement, empty: HTMLElement, captures: CapturePreview[], services: PopupServices): void {
  list.replaceChildren();
  empty.hidden = captures.length !== 0;
  for (const capture of captures) {
    const item = document.createElement("article");
    item.className = "recent-item";

    const heading = document.createElement("div");
    heading.className = "recent-item-heading";
    const platform = document.createElement("span");
    platform.className = "platform-label";
    platform.textContent = capture.platform;
    const sync = document.createElement("span");
    sync.className = "sync-label";
    sync.textContent = capture.syncState === "SYNCED" ? "동기화됨" : "동기화 대기";
    heading.append(platform, sync);
    if (capture.githubCommitStatus) {
      const github = document.createElement("span");
      github.className = `github-label github-${capture.githubCommitStatus.toLowerCase()}`;
      github.textContent = capture.githubCommitStatus === "SUCCEEDED" ? "GitHub 완료"
        : capture.githubCommitStatus === "PENDING" ? "커밋 대기"
          : capture.githubCommitStatus === "RUNNING" ? "커밋 중"
            : capture.githubCommitStatus === "FAILED" ? "커밋 실패"
              : capture.githubCommitStatus === "UNKNOWN" ? "커밋 확인 필요"
                : "자동 커밋 안 함";
      heading.append(github);
    }
    item.append(heading);

    appendCaptureTitle(document, item, capture);
    const metadata = document.createElement("p");
    metadata.className = "recent-meta";
    metadata.textContent = `${canonicalLanguageDisplayName(capture.language)} · 풀이 시간 ${formatSolutionTime(capture.solvedAt ?? capture.observedAt)}`;
    item.append(metadata);
    const performance = document.createElement("p");
    performance.className = "recent-performance";
    performance.textContent = `실행 시간 ${formatExecutionTime(capture.executionTime)} · 메모리 ${formatCaptureMemory(capture)}`;
    item.append(performance);
    const actions = document.createElement("div");
    actions.className = "recent-actions";
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "복사"; copy.setAttribute("aria-label", `${capture.title} 코드 복사`);
    copy.addEventListener("click", () => void services.copyCapture?.(capture.captureId).then(async response => {
      if (response?.ok && typeof response.text === "string") { await services.copy(response.text); copy.textContent = "복사됨"; setTimeout(() => { copy.textContent = "복사"; }, 1200); }
    }));
    const download = document.createElement("button"); download.type = "button"; download.textContent = "다운로드"; download.setAttribute("aria-label", `${capture.title} 코드 다운로드`);
    download.addEventListener("click", () => void services.downloadCapture?.(capture.captureId).then(response => {
      if (response?.ok) { download.textContent = "완료"; setTimeout(() => { download.textContent = "다운로드"; }, 1200); }
    }));
    actions.append(copy, download); item.append(actions);
    list.append(item);
  }
}

export function mountPopup(document: Document, services: PopupServices): void {
  const build = document.querySelector<HTMLElement>("#build-label");
  const updated = document.querySelector<HTMLElement>("#updated-label");
  if (build) build.textContent = buildLabel();
  if (updated) updated.textContent = updatedLabel();
  const count = document.querySelector<HTMLElement>("#pending-count")!;
  const status = document.querySelector<HTMLElement>("#status")!;
  const description = document.querySelector<HTMLElement>("#capture-description")!;
  const error = document.querySelector<HTMLElement>("#error")!;
  const card = document.querySelector<HTMLElement>("#capture-card")!;
  const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
  const recentCard = document.querySelector<HTMLElement>("#recent-card")!;
  const recentCount = document.querySelector<HTMLElement>("#recent-count")!;
  const recentList = document.querySelector<HTMLElement>("#recent-list")!;
  const recentEmpty = document.querySelector<HTMLElement>("#recent-empty")!;
  const recentError = document.querySelector<HTMLElement>("#recent-error")!;
  const autoDownload = document.querySelector<HTMLInputElement>("#auto-download");
  const autoSync = document.querySelector<HTMLInputElement>("#auto-sync");
  const githubAuto = document.querySelector<HTMLInputElement>("#github-auto");
  const automationStatus = document.querySelector<HTMLElement>("#automation-status");
  const automationHelp = document.querySelector<HTMLElement>("#automation-help");
  let loading = false;
  let loadGeneration = 0;

  function resetRecent(): void {
    recentList.replaceChildren();
    recentCount.textContent = "확인 중";
    recentEmpty.hidden = true;
    recentError.hidden = true;
    recentCard.setAttribute("aria-busy", "true");
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    const generation = ++loadGeneration;
    refresh.disabled = true;
    error.hidden = true;
    count.textContent = "—";
    status.textContent = "확인 중";
    description.textContent = "이 브라우저에 저장된 풀이를 확인하고 있어요.";
    card.setAttribute("aria-busy", "true");
    resetRecent();
    try {
      const state = await services.load() as {
        pendingCount?: unknown;
        settings?: unknown;
        recentCaptures?: unknown;
        error?: unknown;
      } | null;
      if (!state || state.error || !state.settings || typeof state.pendingCount !== "number" || !Number.isSafeInteger(state.pendingCount) || state.pendingCount < 0) throw new Error("Invalid state");
      const recentCaptures = Array.isArray(state.recentCaptures)
        ? state.recentCaptures.map(asDisplayCapture).filter((capture): capture is CapturePreview => capture !== null).slice(0, 3)
        : [];
      count.textContent = String(state.pendingCount);
      const settings = state.settings as { autoDownloadEnabled?: boolean; autoSyncEnabled?: boolean; githubAutoCommitEnabled?: boolean; githubTargetConfigured?: boolean; relay?: { status?: string } };
      if (autoDownload) {
        autoDownload.checked = settings.autoDownloadEnabled === true;
        autoDownload.setAttribute("aria-checked", String(autoDownload.checked));
      }
      if (autoSync && githubAuto && automationStatus && automationHelp) {
        autoSync.checked = settings.autoSyncEnabled === true; githubAuto.checked = settings.githubAutoCommitEnabled === true;
        autoSync.setAttribute("aria-checked", String(autoSync.checked)); githubAuto.setAttribute("aria-checked", String(githubAuto.checked));
        // ON grants are dashboard-confirmed. The popup can only turn an
        // existing confirmed setting OFF, never pretend an ON was accepted.
        autoSync.disabled = settings.autoSyncEnabled !== true;
        githubAuto.disabled = true;
        githubAuto.title = "GitHub 자동 커밋은 대시보드에서만 변경할 수 있습니다.";
        const relayStatus = settings.relay?.status;
        automationStatus.textContent = relayStatus === "PENDING" ? "확인 대기" : relayStatus === "OFFLINE" ? "오프라인" : relayStatus === "AUTH_EXPIRED" ? "인증 만료" : relayStatus === "RELAY_ERROR" ? "릴레이 오류" : relayStatus === "REVOCATION_PENDING" ? "서버 폐기 대기" : relayStatus === "CONFIRMED" ? "연결 확인됨" : settings.githubTargetConfigured ? "릴레이 설정 필요" : "대상 필요";
        automationHelp.textContent = relayStatus === "REVOCATION_PENDING" ? "자동 전송은 이미 중지했습니다. 네트워크가 복구되면 서버의 릴레이 권한을 폐기합니다." : relayStatus === "CONFIRMED" ? "자동 동기화는 여기서 끌 수 있습니다. GitHub 자동 커밋은 대시보드에서 변경합니다." : settings.githubTargetConfigured ? "자동 동기화를 켜거나 GitHub 자동 커밋을 바꾸려면 대시보드에서 이 브라우저를 확인하세요." : "GitHub 자동 커밋에는 대시보드에서 저장소 대상을 지정해야 합니다.";
      }
      status.textContent = "로컬 보관";
      description.textContent = state.pendingCount
        ? "통과한 풀이가 기다리고 있어요. 대시보드로 가져가세요."
        : recentCaptures.length
          ? "대기 중인 풀이는 없어요. 저장한 풀이는 아래에서 확인하세요."
          : "아직 저장된 풀이가 없어요. 첫 통과 풀이를 모아보세요.";
      recentCount.textContent = recentCaptures.length ? `${recentCaptures.length}개` : "없음";
      renderRecent(document, recentList, recentEmpty, recentCaptures, services);
      const syncedIds = recentCaptures.filter(capture => capture.syncState === "SYNCED").map(capture => capture.captureId);
      if (syncedIds.length && services.loadGithubStatuses) {
        // Remote enrichment is intentionally detached from the local render.
        // A sleeping or offline API cannot hide locally persisted captures.
        void services.loadGithubStatuses(syncedIds).then(response => {
          if (generation !== loadGeneration) return;
          const statuses = response?.statuses;
          if (!statuses || typeof statuses !== "object") return;
          renderRecent(document, recentList, recentEmpty, recentCaptures.map(capture => ({
            ...capture,
            ...(statuses[capture.captureId] ? { githubCommitStatus: statuses[capture.captureId] } : {})
          })), services);
        }).catch(() => undefined);
      }
    } catch {
      count.textContent = "—";
      status.textContent = "확인 필요";
      description.textContent = "저장된 풀이 수를 확인할 수 없어요.";
      error.hidden = false;
      recentError.hidden = false;
      recentCard.setAttribute("aria-busy", "false");
    } finally {
      loading = false;
      refresh.disabled = false;
      card.setAttribute("aria-busy", "false");
      recentCard.setAttribute("aria-busy", "false");
    }
  }

  refresh.addEventListener("click", () => void load());
  const updateAutomation = (patch: Record<string, boolean>) => {
    if (!services.updateSettings) return;
    void services.updateSettings(patch).then(() => void load()).catch(() => void load());
  };
  autoDownload?.addEventListener("change", () => { autoDownload.setAttribute("aria-checked", String(autoDownload.checked)); updateAutomation({ autoDownloadEnabled: autoDownload.checked }); });
  autoSync?.addEventListener("change", () => { autoSync.setAttribute("aria-checked", String(autoSync.checked)); updateAutomation({ autoSyncEnabled: autoSync.checked }); });
  void load();
}
