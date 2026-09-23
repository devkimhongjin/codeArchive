import { PROGRAMMERS_CODE_SELECTOR, PROGRAMMERS_LESSON_PATH, PROGRAMMERS_ORIGIN, PROGRAMMERS_SUBMIT_SELECTOR } from "./adapters/programmersSelectors";
import { SWEA_EDITOR_SELECTORS, SWEA_ORIGIN, SWEA_SOLVING_PATH, SWEA_SUBMIT_SELECTORS } from "./adapters/sweaSelectors";
import { JUNGOL_ORIGIN, JUNGOL_PROBLEM_PATH, JUNGOL_SOURCE_SELECTOR, jungolSubmitControl } from "./adapters/jungolSelectors";

export const EDITOR_SYNC_ATTRIBUTE = "data-codearchive-editor-sync";

// SWEA's editor has historically been exposed as a global `cEditor` binding.
// Some page revisions declare it with `let`, which makes it available to page
// scripts and inline handlers but does not create `window.cEditor`. Keep the
// declaration type-only and resolve the binding at call time in MAIN world.
declare const cEditor: { save?: () => unknown } | undefined;
type MonacoModel = { uri: { toString(): string }; getValue(): string };
type MonacoApi = { editor?: { getModels?: () => MonacoModel[] } };
declare const monaco: MonacoApi | undefined;

type MainWorldWindow = Window & {
  cEditor?: { save?: () => unknown };
  monaco?: MonacoApi;
};

function isSwea(location: Location): boolean {
  return location.origin === SWEA_ORIGIN && location.pathname === SWEA_SOLVING_PATH;
}

function isProgrammers(location: Location): boolean {
  return location.origin === PROGRAMMERS_ORIGIN && PROGRAMMERS_LESSON_PATH.test(location.pathname);
}

function isJungol(location: Location): boolean {
  return location.origin === JUNGOL_ORIGIN && JUNGOL_PROBLEM_PATH.test(location.pathname);
}

function setSyncStatus(document: Document, status: "synced" | "failed"): void {
  document.documentElement?.setAttribute(EDITOR_SYNC_ATTRIBUTE, `${status}:${Date.now()}`);
}

function syncSwea(document: Document, window: MainWorldWindow): boolean {
  try {
    let editor: MainWorldWindow["cEditor"];
    // `typeof` is safe when the page does not define the binding. The direct
    // lookup is required for page scripts that use a lexical global (`let
    // cEditor`) instead of an own property on window.
    if (typeof cEditor !== "undefined") editor = cEditor;
    else editor = window.cEditor;
    if (!editor || typeof editor.save !== "function") return false;
    editor.save();
    return SWEA_EDITOR_SELECTORS.code.some((selector) => !!document.querySelector(selector));
  } catch {
    return false;
  }
}

function syncProgrammers(document: Document): boolean {
  try {
    const code = document.querySelector<HTMLTextAreaElement>(PROGRAMMERS_CODE_SELECTOR);
    if (!code) return false;
    const textareaEditor = (code as HTMLTextAreaElement & {
      CodeMirror?: { save?: () => unknown; getValue?: () => string };
    }).CodeMirror;
    const wrapper = document.querySelector<HTMLElement>(".CodeMirror") as (HTMLElement & {
      CodeMirror?: { save?: () => unknown; getValue?: () => string };
      save?: () => unknown;
      getValue?: () => string;
    }) | null;
    const codeMirror = textareaEditor ?? wrapper?.CodeMirror ?? (wrapper?.save || wrapper?.getValue ? wrapper : undefined);
    if (codeMirror && typeof codeMirror.save !== "function" && typeof codeMirror.getValue !== "function") return false;
    if (codeMirror && typeof codeMirror.save === "function") codeMirror.save();
    // CodeMirror 5 normally exposes save() on the textarea instance. If a
    // page revision only exposes getValue(), copy that authoritative value to
    // the platform's source field before the isolated listener snapshots it.
    if (codeMirror && typeof codeMirror.getValue === "function") {
      const value = codeMirror.getValue();
      if (typeof value === "string" && code.value !== value) code.value = value;
    }
    // A wrapper without an editor instance is not safe to treat as a synced
    // source. A plain textarea is accepted only when no CodeMirror wrapper is
    // present on the page.
    if (wrapper && !codeMirror) return false;
    return typeof code.value === "string";
  } catch {
    return false;
  }
}

function syncJungol(document: Document, location: Location, window: MainWorldWindow): boolean {
  try {
    const problemNumber = location.pathname.match(JUNGOL_PROBLEM_PATH)?.[1];
    const activeEditors = [...document.querySelectorAll<HTMLElement>(".monaco-editor[data-uri]")];
    if (!problemNumber || activeEditors.length !== 1) return false;
    const uri = activeEditors[0]?.dataset.uri;
    if (!uri || !uri.includes(`/problem_${problemNumber}_`)) return false;
    const api = typeof monaco !== "undefined" ? monaco : window.monaco;
    const matches = api?.editor?.getModels?.().filter((model) => model.uri.toString() === uri) ?? [];
    if (matches.length !== 1) return false;
    const sourceCode = matches[0]?.getValue();
    if (!sourceCode?.trim()) return false;
    const languageButtons = [...document.querySelectorAll("button")].filter((button) =>
      /^language\s+\S/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
    );
    if (languageButtons.length !== 1) return false;
    const language = languageButtons[0]?.textContent?.replace(/\s+/g, " ").trim().replace(/^language\s+/, "");
    if (!language || language.length > 100) return false;
    let source = document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
    if (!source) {
      source = document.createElement("textarea");
      source.dataset.codearchiveJungolSource = "";
      source.hidden = true;
      (document.body ?? document.documentElement).append(source);
    }
    source.value = sourceCode;
    source.dataset.codearchiveJungolProblem = problemNumber;
    source.dataset.codearchiveJungolLanguage = language;
    return true;
  } catch {
    return false;
  }
}

export function syncEditorAtSubmitClick(document: Document, location: Location, window: MainWorldWindow = globalThis as unknown as MainWorldWindow): boolean {
  const synced = isSwea(location)
    ? syncSwea(document, window)
    : isProgrammers(location)
      ? syncProgrammers(document)
      : isJungol(location)
        ? syncJungol(document, location, window)
      : false;
  setSyncStatus(document, synced ? "synced" : "failed");
  return synced;
}

function submitTarget(target: EventTarget | null, document: Document, location: Location): Element | null {
  const ElementConstructor = document.defaultView?.Element;
  if (!target) return null;
  if (ElementConstructor && !(target instanceof ElementConstructor)) return null;
  if (!ElementConstructor && typeof (target as unknown as { closest?: unknown }).closest !== "function") return null;
  const element = target as Element;
  if (isJungol(location)) {
    let current: Element | null = element;
    while (current) {
      if (jungolSubmitControl(current)) return current;
      current = current.parentElement;
    }
    return null;
  }
  const selectors = isSwea(location) ? SWEA_SUBMIT_SELECTORS : isProgrammers(location) ? [PROGRAMMERS_SUBMIT_SELECTOR] : [];
  for (const selector of selectors) {
    const match = element.closest(selector);
    if (match) return match;
  }
  return null;
}

export function installMainWorldSync(document: Document, location: Location, window: MainWorldWindow = globalThis as unknown as MainWorldWindow): () => void {
  const onClick = (event: Event) => {
    if (submitTarget(event.target, document, location)) void syncEditorAtSubmitClick(document, location, window);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installMainWorldSync(document, window.location, window);
}
