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
type PlatformFilter = "ALL" | Capture["platform"];
type SortOrder = "latest" | "oldest" | "problem" | "title";
type CaptureGroup = { key: string; captures: Capture[] };
type Detail = { source: HTMLElement; viewer: HTMLElement; capture: Capture; generation: number };

function asDisplayCapture(value: unknown): Capture | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<Capture>;
  if (typeof c.captureId !== "string" ||
      (c.platform !== "SWEA" && c.platform !== "PROGRAMMERS" && c.platform !== "JUNGOL") ||
      typeof c.problemNumber !== "string" || typeof c.title !== "string" ||
      typeof c.problemUrl !== "string" || typeof c.language !== "string" ||
      typeof c.sourceCode !== "string" || c.result !== "ACCEPTED" ||
      (c.syncState !== "PENDING" && c.syncState !== "SYNCED") ||
      typeof c.observedAt !== "string" || Number.isNaN(Date.parse(c.observedAt))) return null;
  return c as Capture;
}

function safeProblemUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function selectOption(select: HTMLSelectElement, value: string): void {
  try { select.value = value; return; } catch {
    for (const option of Array.from(select.querySelectorAll("option"))) {
      if (option.value === value) option.setAttribute("selected", "");
      else option.removeAttribute("selected");
    }
  }
}

function groupsFor(captures: Capture[], query: string, platform: PlatformFilter, language: string, sort: SortOrder): CaptureGroup[] {
  const grouped = new Map<string, Capture[]>();
  for (const capture of captures) {
    if (platform !== "ALL" && capture.platform !== platform) continue;
    const key = `${capture.platform}:${capture.problemNumber}`;
    const existing = grouped.get(key) ?? [];
    existing.push(capture);
    grouped.set(key, existing);
  }
  const needle = query.trim().toLocaleLowerCase();
  return Array.from(grouped, ([key, records]) => ({ key, captures: records.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)) }))
    .filter(group => (language === "ALL" || group.captures.some(c => canonicalLanguageDisplayName(c.language) === language)) &&
      (!needle || group.captures.some(c =>
        [c.platform, c.problemNumber, c.title, canonicalLanguageDisplayName(c.language)].some(value => value.toLocaleLowerCase().includes(needle)))))
    .sort((a, b) => sort === "title" ? a.captures[0]!.title.localeCompare(b.captures[0]!.title, "ko")
      : sort === "problem" ? a.captures[0]!.problemNumber.localeCompare(b.captures[0]!.problemNumber, "ko", { numeric: true })
      : (Date.parse(b.captures[0]!.observedAt) - Date.parse(a.captures[0]!.observedAt)) * (sort === "oldest" ? -1 : 1));
}

function renderRow(document: Document, group: CaptureGroup, selected: boolean, onSelect: () => void): HTMLElement {
  const latest = group.captures[0]!;
  const row = element(document, "button", `solution-row${selected ? " selected" : ""}`);
  row.type = "button";
  row.dataset.captureId = latest.captureId;
  row.setAttribute("aria-pressed", String(selected));
  const logo = element(document, "span", `platform-logo ${latest.platform.toLowerCase()}`, latest.platform === "PROGRAMMERS" ? "P" : latest.platform === "JUNGOL" ? "J" : "S");
  const main = element(document, "span", "solution-row-main");
  const top = element(document, "span", "solution-row-top");
  top.append(element(document, "span", "solution-platform", latest.platform), element(document, "span", "solution-result", `풀이 ${group.captures.length}개`));
  const languages = Array.from(new Set(group.captures.map(c => canonicalLanguageDisplayName(c.language)))).join(", ");
  main.append(top, element(document, "span", "solution-title", latest.title),
    element(document, "span", "solution-row-bottom", `#${latest.problemNumber} · ${languages} · ${formatSolutionTime(latest.solvedAt ?? latest.observedAt)}`));
  const chevron = element(document, "span", "solution-chevron", "›");
  chevron.setAttribute("aria-hidden", "true");
  row.append(logo, main, chevron);
  row.addEventListener("click", onSelect);
  return row;
}

function renderDetail(document: Document, capture: Capture, group: CaptureGroup, onSelectSubmission: (id: string) => void): { item: HTMLElement } & Detail {
  const item = element(document, "article", "capture-card");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capture.captureId)) item.id = `capture-${capture.captureId}`;
  const heading = element(document, "div", "detail-heading");
  const headingMain = element(document, "div", "detail-heading-main");
  headingMain.append(element(document, "div", "detail-breadcrumb", `${capture.platform}  ›  #${capture.problemNumber}`),
    element(document, "h2", "detail-title", capture.title),
    element(document, "div", "detail-subline", `${canonicalLanguageDisplayName(capture.language)} · 풀이 시간 ${formatSolutionTime(capture.solvedAt ?? capture.observedAt)}`));
  const actions = element(document, "div", "detail-heading-actions");
  actions.append(element(document, "span", `sync-label ${capture.syncState.toLowerCase()}`, capture.historicalImport === true ? capture.syncState === "SYNCED" ? "과거 풀이 · 서버 동기화됨" : "과거 풀이 · 로컬만" : capture.syncState === "SYNCED" ? "대시보드 동기화됨" : "동기화 대기"));
  if (safeProblemUrl(capture.problemUrl)) {
    const link = element(document, "a", "problem-link", "문제 보기 ↗");
    link.href = capture.problemUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    actions.append(link);
  }
  heading.append(headingMain, actions);
  item.append(heading);

  const metrics = element(document, "div", "metrics-row");
  for (const [label, value] of [
    ["실행 시간", formatExecutionTime(capture.executionTime)],
    ["메모리 사용량", formatCaptureMemory(capture)],
    ["풀이 시간", formatSolutionTime(capture.solvedAt ?? capture.observedAt)]
  ] as Array<[string, string]>) {
    const metric = element(document, "div", "metric-card");
    metric.append(element(document, "span", "metric-label", label), element(document, "strong", "", value));
    metrics.append(metric);
  }
  item.append(metrics);

  if (group.captures.length > 1) {
    const label = element(document, "label", "submission-picker", "제출 기록 ");
    const picker = element(document, "select", "");
    picker.setAttribute("aria-label", "제출 기록");
    group.captures.forEach((c, index) => {
      const option = document.createElement("option");
      option.value = c.captureId;
      option.textContent = `${index + 1}. ${formatSolutionTime(c.solvedAt ?? c.observedAt)} · ${canonicalLanguageDisplayName(c.language)}`;
      picker.append(option);
    });
    selectOption(picker, capture.captureId);
    picker.addEventListener("change", () => onSelectSubmission(picker.value));
    label.append(picker);
    item.append(label);
  }

  const codeBlock = element(document, "div", "capture-code-block");
  const toolbar = element(document, "div", "code-toolbar");
  const title = element(document, "strong", "code-toolbar-title", "⌘  소스 코드");
  const suffix = element(document, "span", "code-extension", `.${sourceFileExtension(capture.language)}`);
  toolbar.append(title, suffix);
  codeBlock.append(toolbar);
  const viewer = element(document, "div", "capture-code-viewer");
  viewer.setAttribute("role", "region");
  viewer.setAttribute("aria-label", "소스 코드");
  const gutter = element(document, "div", "capture-code-gutter");
  gutter.setAttribute("aria-hidden", "true");
  capture.sourceCode.split("\n").forEach((_, index) => gutter.append(element(document, "span", "", String(index + 1))));
  const source = element(document, "pre", "source-code", capture.sourceCode);
  viewer.append(gutter, source);
  codeBlock.append(viewer);
  item.append(codeBlock);
  return { item, source, viewer, capture, generation: 0 };
}

function readThemeMode(document: Document): CodeThemeMode {
  try {
    const value = document.defaultView?.localStorage?.getItem(CODE_THEME_MODE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch { /* Local storage is optional. */ }
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

export function mountArchive(document: Document, services: ArchiveServices): void {
  const build = document.querySelector<HTMLElement>("#archive-build-label");
  const updated = document.querySelector<HTMLElement>("#archive-updated-label");
  if (build) build.textContent = buildLabel();
  if (updated) updated.textContent = updatedLabel();
  const card = document.querySelector<HTMLElement>(".archive-card")!;
  const refresh = document.querySelector<HTMLButtonElement>("#archive-refresh")!;
  const count = document.querySelector<HTMLElement>("#archive-count")!;
  const filteredCount = document.querySelector<HTMLElement>("#archive-filtered-count")!;
  const search = document.querySelector<HTMLInputElement>("#archive-search")!;
  const languageSelect = document.querySelector<HTMLSelectElement>("#archive-language")!;
  const sortSelect = document.querySelector<HTMLSelectElement>("#archive-sort")!;
  const themeSelect = document.querySelector<HTMLSelectElement>("#archive-code-theme")!;
  const error = document.querySelector<HTMLElement>("#archive-error")!;
  const list = document.querySelector<HTMLElement>("#archive-list")!;
  const detail = document.querySelector<HTMLElement>("#archive-detail")!;
  const empty = document.querySelector<HTMLElement>("#archive-empty")!;
  const platformButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-platform]"));
  populateThemes(document, themeSelect);
  let captures: Capture[] = [];
  let selectedId = "";
  let platformFilter: PlatformFilter = "ALL";
  let sort: SortOrder = "latest";
  let themeMode = readThemeMode(document);
  let themeSettings: Pick<CaptureSettings, "lightTheme" | "darkTheme"> = { lightTheme: "github-light", darkTheme: "github-dark" };
  let active: Detail | null = null;
  let loading = false;

  function highlight(rendered: Detail): void {
    const generation = ++rendered.generation;
    const theme = themeMode === "dark" ? themeSettings.darkTheme! : themeSettings.lightTheme!;
    if (rendered.source.dataset.shikiTheme === theme) return;
    rendered.viewer.style.colorScheme = themeMode;
    rendered.source.textContent = rendered.capture.sourceCode;
    rendered.source.removeAttribute("data-shiki-theme");
    rendered.source.style.backgroundColor = "";
    rendered.source.style.color = "";
    rendered.viewer.style.backgroundColor = "";
    rendered.viewer.style.color = "";
    void tokensForSource(rendered.capture.sourceCode, rendered.capture.language, themeSettings, themeMode === "dark").then(result => {
      if (generation !== rendered.generation || active !== rendered || !result || !rendered.source.isConnected) return;
      rendered.source.replaceChildren();
      rendered.source.dataset.shikiTheme = result.theme;
      rendered.source.style.backgroundColor = result.background ?? "";
      rendered.source.style.color = result.foreground ?? "";
      rendered.viewer.style.backgroundColor = result.background ?? "";
      rendered.viewer.style.color = result.foreground ?? "";
      result.tokens.forEach((line, index) => {
        line.forEach(token => {
          const span = document.createElement("span");
          span.textContent = token.content;
          if (token.color) span.style.color = token.color;
          rendered.source.append(span);
        });
        if (index < result.tokens.length - 1) rendered.source.append("\n");
      });
    }).catch(() => undefined);
  }

  function renderView(forceDetail = false): void {
    const groups = groupsFor(captures, search.value ?? "", platformFilter, languageSelect.value || "ALL", sort);
    filteredCount.textContent = String(groups.length);
    empty.hidden = groups.length !== 0;
    empty.textContent = captures.length ? "조건에 맞는 풀이가 없어요." : "아직 저장된 풀이가 없어요.";
    const language = languageSelect.value || "ALL";
    if (!groups.some(group => group.captures.some(c => c.captureId === selectedId && (language === "ALL" || canonicalLanguageDisplayName(c.language) === language)))) {
      selectedId = (groups[0]?.captures.find(c => language === "ALL" || canonicalLanguageDisplayName(c.language) === language) ?? groups[0]?.captures[0])?.captureId ?? "";
    }
    list.replaceChildren(...groups.map(group => renderRow(document, group, group.captures.some(c => c.captureId === selectedId), () => {
      selectedId = group.captures[0]!.captureId;
      renderView();
    })));
    const group = groups.find(g => g.captures.some(c => c.captureId === selectedId));
    const capture = group?.captures.find(c => c.captureId === selectedId);
    if (active && capture && active.capture.captureId === capture.captureId && !forceDetail) return;
    if (active) ++active.generation;
    if (!group || !capture) {
      active = null;
      detail.replaceChildren(element(document, "div", "detail-empty", "왼쪽 목록에서 풀이를 선택하면 실행 정보와 코드를 볼 수 있어요."));
      return;
    }
    const rendered = renderDetail(document, capture, group, id => { selectedId = id; renderView(); });
    active = rendered;
    detail.replaceChildren(rendered.item);
    highlight(rendered);
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    card.setAttribute("aria-busy", "true");
    error.textContent = "저장된 풀이를 불러오지 못했어요. 새로고침으로 다시 확인해 주세요.";
    error.hidden = true;
    try {
      const state = await services.load() as { captures?: unknown; settings?: unknown; error?: unknown } | null;
      if (!state || state.error || !Array.isArray(state.captures)) throw new Error("Invalid state");
      captures = state.captures.map(asDisplayCapture).filter((c): c is Capture => c !== null);
      const previousLanguage = languageSelect.value || "ALL";
      const languageOptions = Array.from(new Set(captures.map(c => canonicalLanguageDisplayName(c.language)))).sort((a, b) => a.localeCompare(b, "ko"));
      languageSelect.replaceChildren(element(document, "option", "", "모든 언어"), ...languageOptions.map(language => {
        const option = element(document, "option", "", language);
        option.value = language;
        return option;
      }));
      languageSelect.querySelector("option")!.value = "ALL";
      selectOption(languageSelect, languageOptions.includes(previousLanguage) ? previousLanguage : "ALL");
      const settings = state.settings && typeof state.settings === "object" ? state.settings as Partial<CaptureSettings> : {};
      themeSettings = {
        lightTheme: settings.lightTheme && isLightTheme(settings.lightTheme) ? settings.lightTheme : "github-light",
        darkTheme: settings.darkTheme && isDarkTheme(settings.darkTheme) ? settings.darkTheme : "github-dark"
      };
      selectOption(themeSelect, themeMode === "dark" ? themeSettings.darkTheme! : themeSettings.lightTheme!);
      count.textContent = String(captures.length);
      const hash = document.defaultView?.location?.hash?.slice(1) ?? "";
      if (hash && !selectedId) {
        try { selectedId = decodeURIComponent(hash); } catch { /* Ignore malformed fragments. */ }
      }
      renderView(true);
    } catch {
      captures = [];
      count.textContent = "—";
      renderView();
      error.hidden = false;
    } finally {
      loading = false;
      refresh.disabled = false;
      card.setAttribute("aria-busy", "false");
    }
  }

  refresh.addEventListener("click", () => void load());
  search.addEventListener("input", () => renderView());
  languageSelect.addEventListener("change", () => renderView());
  sortSelect.addEventListener("change", () => { sort = sortSelect.value as SortOrder; renderView(); });
  platformButtons.forEach(button => button.addEventListener("click", () => {
    platformFilter = button.dataset.platform as PlatformFilter;
    platformButtons.forEach(candidate => candidate.classList.toggle("active", candidate === button));
    renderView();
  }));
  themeSelect.addEventListener("change", () => {
    const selected = themeSelect.value;
    if (!isLightTheme(selected) && !isDarkTheme(selected)) return;
    themeMode = isLightTheme(selected) ? "light" : "dark";
    try { document.defaultView?.localStorage?.setItem(CODE_THEME_MODE_KEY, themeMode); } catch { /* Preview remains active. */ }
    themeSettings = isLightTheme(selected) ? { ...themeSettings, lightTheme: selected } : { ...themeSettings, darkTheme: selected };
    if (active) highlight(active);
    if (services.updateThemes) void services.updateThemes(themeSettings.lightTheme!, themeSettings.darkTheme!).catch(() => {
      error.textContent = "테마를 저장하지 못했어요. 다시 선택해 주세요.";
      error.hidden = false;
    });
  });
  void load();
}
