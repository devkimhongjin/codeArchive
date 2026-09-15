import type { Capture } from "./types";

type CapturePreview = Omit<Capture, "sourceCode">;

interface PopupServices {
  load: () => Promise<unknown>;
  extensionId: string;
  copy: (text: string) => Promise<void>;
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
  return candidate as CapturePreview;
}

function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

function renderRecent(document: Document, list: HTMLElement, empty: HTMLElement, captures: CapturePreview[]): void {
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
    item.append(heading);

    appendCaptureTitle(document, item, capture);
    const metadata = document.createElement("p");
    metadata.className = "recent-meta";
    metadata.textContent = `${capture.language} · ${formatObservedAt(capture.observedAt)}`;
    item.append(metadata);
    list.append(item);
  }
}

export function mountPopup(document: Document, services: PopupServices): void {
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
  const copy = document.querySelector<HTMLButtonElement>("#copy-id")!;
  const copyStatus = document.querySelector<HTMLElement>("#copy-status")!;
  let loading = false;

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
      status.textContent = "로컬 보관";
      description.textContent = state.pendingCount
        ? "통과한 풀이가 기다리고 있어요. 대시보드로 가져가세요."
        : recentCaptures.length
          ? "대기 중인 풀이는 없어요. 저장한 풀이는 아래에서 확인하세요."
          : "아직 저장된 풀이가 없어요. 첫 통과 풀이를 모아보세요.";
      recentCount.textContent = recentCaptures.length ? `${recentCaptures.length}개` : "없음";
      renderRecent(document, recentList, recentEmpty, recentCaptures);
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
  copy.disabled = !/^[a-p]{32}$/.test(services.extensionId);
  copy.addEventListener("click", () => {
    copy.disabled = true;
    void services.copy(services.extensionId).then(() => {
      copyStatus.textContent = "진단용 ID를 복사했어요. 연결에는 입력할 필요가 없어요.";
    }).catch(() => {
      copyStatus.textContent = `복사하지 못했어요. ID: ${services.extensionId}`;
    }).finally(() => { copy.disabled = false; });
  });
  void load();
}
