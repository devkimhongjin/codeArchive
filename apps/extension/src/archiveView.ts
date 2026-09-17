import type { Capture } from "./types";
import { tokensForSource } from "./highlighter";
import { canonicalLanguageDisplayName } from "../../../shared/language";

interface ArchiveServices {
  load: () => Promise<unknown>;
  updateThemes?: (lightTheme: string, darkTheme: string) => Promise<unknown>;
}

function asDisplayCapture(value: unknown): Capture | null {
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
    typeof candidate.sourceCode !== "string" ||
    candidate.result !== "ACCEPTED" ||
    (candidate.syncState !== "PENDING" && candidate.syncState !== "SYNCED") ||
    typeof candidate.observedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.observedAt))
  ) {
    return null;
  }
  return candidate as Capture;
}

function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function isSafeProblemUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function appendTitle(document: Document, item: HTMLElement, capture: Capture): void {
  const text = `#${capture.problemNumber} · ${capture.title}`;
  if (!isSafeProblemUrl(capture.problemUrl)) {
    const title = document.createElement("span");
    title.className = "capture-title-text";
    title.textContent = text;
    item.append(title);
    return;
  }
  const link = document.createElement("a");
  link.className = "capture-title";
  link.href = capture.problemUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  item.append(link);
}

function renderCapture(document: Document, capture: Capture): { item: HTMLElement; source: HTMLElement } {
  const item = document.createElement("article");
  item.className = "capture-card";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capture.captureId)) {
    item.id = `capture-${capture.captureId}`;
  }

  const heading = document.createElement("div");
  heading.className = "capture-heading";
  const platform = document.createElement("span");
  platform.className = "platform-label";
  platform.textContent = capture.platform;
  const sync = document.createElement("span");
  sync.className = "sync-label";
  sync.textContent = capture.syncState === "SYNCED" ? "대시보드 동기화됨" : "동기화 대기";
  heading.append(platform, sync);
  item.append(heading);

  appendTitle(document, item, capture);

  const metadata = document.createElement("p");
  metadata.className = "capture-meta";
  const language = document.createElement("span");
  language.textContent = canonicalLanguageDisplayName(capture.language);
  const date = document.createElement("span");
  date.textContent = `저장 ${formatObservedAt(capture.observedAt)}`;
  metadata.append(language, date);
  item.append(metadata);

  const details = document.createElement("details");
  details.className = "source-details";
  const summary = document.createElement("summary");
  summary.textContent = "코드 보기";
  const source = document.createElement("pre");
  source.className = "source-code";
  source.textContent = capture.sourceCode;
  details.append(summary, source);
  item.append(details);

  const metrics: string[] = [];
  if (capture.executionTime !== undefined) metrics.push(`실행 ${capture.executionTime}ms`);
  if (capture.memoryValue !== undefined && capture.memoryUnit && capture.memoryUnit !== "UNKNOWN") metrics.push(`메모리 ${capture.memoryValue}${capture.memoryUnit}`);
  else if (capture.memoryUsage !== undefined) metrics.push(`메모리 ${capture.memoryUsage} (단위 미확인)`);
  if (metrics.length) {
    const metricLine = document.createElement("p");
    metricLine.className = "capture-metrics";
    metricLine.textContent = metrics.join(" · ");
    item.append(metricLine);
  }
  return { item, source };
}

function selectTheme(select: HTMLSelectElement, value: string): void {
  try { select.value = value; return; } catch {
    // Browser selects support value assignment; the lightweight archive test DOM
    // exposes a getter only, so preserve the same selected-option semantics.
    for (const option of Array.from(select.querySelectorAll('option'))) {
      if (option.getAttribute('value') === value) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
    }
  }
}

export function mountArchive(document: Document, services: ArchiveServices): void {
  const card = document.querySelector<HTMLElement>(".archive-card")!;
  const refresh = document.querySelector<HTMLButtonElement>("#archive-refresh")!;
  const count = document.querySelector<HTMLElement>("#archive-count")!;
  const error = document.querySelector<HTMLElement>("#archive-error")!;
  const list = document.querySelector<HTMLElement>("#archive-list")!;
  const empty = document.querySelector<HTMLElement>("#archive-empty")!;
  const lightTheme = document.querySelector<HTMLSelectElement>("#archive-light-theme");
  const darkTheme = document.querySelector<HTMLSelectElement>("#archive-dark-theme");
  let loading = false;
  let renderGeneration = 0;

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    card.setAttribute("aria-busy", "true");
    error.hidden = true;
    empty.hidden = true;
    list.replaceChildren();
    count.textContent = "—";
    try {
      const state = await services.load() as { captures?: unknown; settings?: unknown; error?: unknown } | null;
      if (!state || state.error || !Array.isArray(state.captures)) throw new Error("Invalid state");
      const captures = state.captures.map(asDisplayCapture).filter((capture): capture is Capture => capture !== null);
      const settings = state.settings && typeof state.settings === "object" ? state.settings as { lightTheme?: "github-light" | "vitesse-light" | "catppuccin-latte" | "solarized-light" | "one-light"; darkTheme?: "github-dark" | "vitesse-dark" | "vitesse-dark" | "catppuccin-mocha" | "dracula" | "one-dark-pro" } : {};
      if (lightTheme && settings.lightTheme) selectTheme(lightTheme, settings.lightTheme);
      if (darkTheme && settings.darkTheme) selectTheme(darkTheme, settings.darkTheme);
      const generation = ++renderGeneration;
      const dark = document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
      count.textContent = String(captures.length);
      empty.hidden = captures.length !== 0;
      for (const capture of captures) {
        const rendered = renderCapture(document, capture); list.append(rendered.item);
        void tokensForSource(capture.sourceCode, capture.language, settings, dark).then(highlighted => {
          if (generation !== renderGeneration || !highlighted || !rendered.source.isConnected) return;
          rendered.source.replaceChildren();
          rendered.source.dataset.shikiTheme = highlighted.theme;
          rendered.source.style.backgroundColor = highlighted.background ?? "";
          rendered.source.style.color = highlighted.foreground ?? "";
          highlighted.tokens.forEach((line, lineIndex) => {
            line.forEach(token => { const span = document.createElement("span"); span.textContent = token.content; if (token.color) span.style.color = token.color; rendered.source.append(span); });
            if (lineIndex < highlighted.tokens.length - 1) rendered.source.append("\n");
          });
        }).catch(() => undefined);
      }
      const rawHash = document.defaultView?.location.hash.slice(1) ?? "";
      if (rawHash) {
        try {
          const target = document.getElementById(`capture-${decodeURIComponent(rawHash)}`);
          if (target) {
            target.querySelector("details")?.setAttribute("open", "");
            target.scrollIntoView?.({ block: "start" });
          }
        } catch {
          // Ignore malformed fragments; the archive remains fully usable.
        }
      }
    } catch {
      error.hidden = false;
    } finally {
      loading = false;
      refresh.disabled = false;
      card.setAttribute("aria-busy", "false");
    }
  }

  refresh.addEventListener("click", () => void load());
  const saveThemes = () => {
    if (!lightTheme || !darkTheme || !services.updateThemes) return;
    void services.updateThemes(lightTheme.value, darkTheme.value).then(() => void load()).catch(() => void load());
  };
  lightTheme?.addEventListener("change", saveThemes);
  darkTheme?.addEventListener("change", saveThemes);
  void load();
}
