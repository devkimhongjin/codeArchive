import type { Capture, CaptureSettings } from "./types";
import { tokensForSource } from "./highlighter";
import { sourceFileExtension } from "./export";
import { canonicalLanguageDisplayName } from "../../../shared/language";
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from "./capturePresentation";
import { buildLabel, updatedLabel } from "../../../shared/buildMetadata";
import { CODE_THEME_MODE_KEY, DARK_THEMES, LIGHT_THEMES, isDarkTheme, isLightTheme, type CodeThemeMode } from "../../../shared/codeThemes";

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

function renderCapture(document: Document, capture: Capture): { item: HTMLElement; source: HTMLElement; viewer: HTMLElement; themeSelect: HTMLSelectElement; capture: Capture } {
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
  date.textContent = `풀이 시간 ${formatSolutionTime(capture.solvedAt ?? capture.observedAt)}`;
  metadata.append(language, date);
  item.append(metadata);

  const metricLine = document.createElement("div");
  metricLine.className = "capture-metrics";
  for (const [label, value] of [
    ["실행 시간", formatExecutionTime(capture.executionTime)],
    ["메모리 사용량", formatCaptureMemory(capture)],
    ["풀이 시간", formatSolutionTime(capture.solvedAt ?? capture.observedAt)]
  ] as Array<[string, string]>) {
    const metric = document.createElement("div");
    metric.className = "capture-metric";
    const caption = document.createElement("span");
    caption.textContent = label;
    const amount = document.createElement("strong");
    amount.textContent = value;
    metric.append(caption, amount);
    metricLine.append(metric);
  }
  item.append(metricLine);

  const toolbar = document.createElement("div");
  toolbar.className = "capture-code-toolbar";
  const toolbarTitle = document.createElement("strong");
  toolbarTitle.textContent = "소스 코드";
  const extension = document.createElement("span");
  extension.textContent = `.${sourceFileExtension(capture.language)}`;
  toolbar.append(toolbarTitle, extension);
  item.append(toolbar);

  const viewer = document.createElement("div");
  viewer.className = "capture-code-viewer";
  viewer.setAttribute("role", "region");
  viewer.setAttribute("aria-label", "소스 코드");
  const themeControls = document.createElement("div");
  themeControls.className = "capture-code-theme-controls";
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "테마 ";
  const themeSelect = document.createElement("select");
  themeSelect.className = "capture-code-theme";
  themeSelect.setAttribute("aria-label", "코드 보기 테마");
  populateThemes(document, themeSelect);
  themeLabel.append(themeSelect);
  themeControls.append(themeLabel);
  const gutter = document.createElement("div");
  gutter.className = "capture-code-gutter";
  gutter.setAttribute("aria-hidden", "true");
  capture.sourceCode.split("\n").forEach((_, index) => {
    const number = document.createElement("span");
    number.textContent = String(index + 1);
    gutter.append(number);
  });
  const source = document.createElement("pre");
  source.className = "source-code";
  source.textContent = capture.sourceCode;
  viewer.append(themeControls, gutter, source);
  item.append(viewer);
  return { item, source, viewer, themeSelect, capture };
}

function readThemeMode(document: Document): CodeThemeMode {
  try {
    const value = document.defaultView?.localStorage?.getItem(CODE_THEME_MODE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch { /* The viewer remains usable without local storage. */ }
  return document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function populateThemes(document: Document, select: HTMLSelectElement): void {
  for (const [label, themes] of [["밝은 테마", LIGHT_THEMES], ["어두운 테마", DARK_THEMES]] as const) {
    const group = document.createElement("optgroup");
    group.label = label;
    themes.forEach(theme => {
      const option = document.createElement("option");
      option.value = theme;
      option.textContent = theme;
      group.append(option);
    });
    select.append(group);
  }
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
  const build = document.querySelector<HTMLElement>("#archive-build-label");
  const updated = document.querySelector<HTMLElement>("#archive-updated-label");
  if (build) build.textContent = buildLabel();
  if (updated) updated.textContent = updatedLabel();
  const card = document.querySelector<HTMLElement>(".archive-card")!;
  const refresh = document.querySelector<HTMLButtonElement>("#archive-refresh")!;
  const count = document.querySelector<HTMLElement>("#archive-count")!;
  const error = document.querySelector<HTMLElement>("#archive-error")!;
  const list = document.querySelector<HTMLElement>("#archive-list")!;
  const empty = document.querySelector<HTMLElement>("#archive-empty")!;
  let themeMode = readThemeMode(document);
  let themeSettings: Pick<CaptureSettings, "lightTheme" | "darkTheme"> = { lightTheme: "github-light", darkTheme: "github-dark" };
  let renderedSources: ReturnType<typeof renderCapture>[] = [];
  let loading = false;
  let renderGeneration = 0;

  function renderHighlights(): void {
    const generation = ++renderGeneration;
    for (const rendered of renderedSources) {
      selectTheme(rendered.themeSelect, themeMode === "dark" ? themeSettings.darkTheme! : themeSettings.lightTheme!);
      rendered.viewer.style.colorScheme = themeMode;
      rendered.source.textContent = rendered.capture.sourceCode;
      rendered.source.removeAttribute("data-shiki-theme");
      rendered.source.style.backgroundColor = "";
      rendered.source.style.color = "";
      rendered.viewer.style.backgroundColor = "";
      rendered.viewer.style.color = "";
      void tokensForSource(rendered.capture.sourceCode, rendered.capture.language, themeSettings, themeMode === "dark").then(highlighted => {
        if (generation !== renderGeneration || !highlighted || !rendered.source.isConnected) return;
        rendered.source.replaceChildren();
        rendered.source.dataset.shikiTheme = highlighted.theme;
        rendered.source.style.backgroundColor = highlighted.background ?? "";
        rendered.source.style.color = highlighted.foreground ?? "";
        rendered.viewer.style.backgroundColor = highlighted.background ?? "";
        rendered.viewer.style.color = highlighted.foreground ?? "";
        highlighted.tokens.forEach((line, lineIndex) => {
          line.forEach(token => {
            const span = document.createElement("span");
            span.textContent = token.content;
            if (token.color) span.style.color = token.color;
            rendered.source.append(span);
          });
          if (lineIndex < highlighted.tokens.length - 1) rendered.source.append("\n");
        });
      }).catch(() => undefined);
    }
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    card.setAttribute("aria-busy", "true");
    error.textContent = "저장된 풀이를 불러오지 못했어요. 새로고침으로 다시 확인해 주세요.";
    error.hidden = true;
    empty.hidden = true;
    ++renderGeneration;
    renderedSources = [];
    list.replaceChildren();
    count.textContent = "—";
    try {
      const state = await services.load() as { captures?: unknown; settings?: unknown; error?: unknown } | null;
      if (!state || state.error || !Array.isArray(state.captures)) throw new Error("Invalid state");
      const captures = state.captures.map(asDisplayCapture).filter((capture): capture is Capture => capture !== null);
      const settings = state.settings && typeof state.settings === "object" ? state.settings as Partial<CaptureSettings> : {};
      themeSettings = {
        lightTheme: settings.lightTheme && isLightTheme(settings.lightTheme) ? settings.lightTheme : "github-light",
        darkTheme: settings.darkTheme && isDarkTheme(settings.darkTheme) ? settings.darkTheme : "github-dark"
      };
      count.textContent = String(captures.length);
      empty.hidden = captures.length !== 0;
      for (const capture of captures) {
        const rendered = renderCapture(document, capture);
        rendered.themeSelect.addEventListener("change", () => saveTheme(rendered.themeSelect));
        renderedSources.push(rendered);
        list.append(rendered.item);
      }
      renderHighlights();
      const rawHash = document.defaultView?.location.hash.slice(1) ?? "";
      if (rawHash) {
        try {
          const target = document.getElementById(`capture-${decodeURIComponent(rawHash)}`);
          if (target) {
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
  const saveTheme = (themeSelect: HTMLSelectElement) => {
    const selected = themeSelect.value;
    if (!isLightTheme(selected) && !isDarkTheme(selected)) return;
    themeMode = isLightTheme(selected) ? "light" : "dark";
    try { document.defaultView?.localStorage?.setItem(CODE_THEME_MODE_KEY, themeMode); } catch { /* Preview remains active. */ }
    themeSettings = isLightTheme(selected)
      ? { ...themeSettings, lightTheme: selected }
      : { ...themeSettings, darkTheme: selected };
    renderHighlights();
    if (services.updateThemes) {
      void services.updateThemes(themeSettings.lightTheme!, themeSettings.darkTheme!).catch(() => {
        error.textContent = "테마를 저장하지 못했어요. 다시 선택해 주세요.";
        error.hidden = false;
      });
    }
  };
  void load();
}
