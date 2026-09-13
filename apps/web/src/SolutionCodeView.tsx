import { useEffect, useState, type CSSProperties } from "react";
import type { BundledLanguage, BundledTheme } from "shiki";

const THEME_KEY = "codearchive.code-theme";
const THEMES = ["github-dark", "github-light", "one-light", "one-dark-pro", "dark-plus", "light-plus", "dracula", "nord", "monokai", "catppuccin-mocha", "catppuccin-latte", "material-theme-palenight", "min-dark", "min-light", "rose-pine", "rose-pine-dawn", "tokyo-night", "vitesse-light"] as const;
type CodeTheme = (typeof THEMES)[number];

const LANGUAGES: Record<string, BundledLanguage> = {
  java: "java", JAVA: "java", "c++": "cpp", cpp: "cpp", C: "c", c: "c",
  python: "python", PYTHON: "python", javascript: "javascript", JAVASCRIPT: "javascript",
  typescript: "typescript", TYPESCRIPT: "typescript", js: "javascript", ts: "typescript",
};

type Highlighter = Awaited<ReturnType<typeof import("shiki/core")["createHighlighterCore"]>>;
const highlighterPromise = new Map<string, Promise<Highlighter>>();
const languageLoaders: Record<string, () => Promise<{ default: unknown }>> = {
  java: () => import("shiki/dist/langs/java"), cpp: () => import("shiki/dist/langs/cpp"), c: () => import("shiki/dist/langs/c"),
  python: () => import("shiki/dist/langs/python"), javascript: () => import("shiki/dist/langs/javascript"), typescript: () => import("shiki/dist/langs/typescript"),
};
const themeLoaders: Record<CodeTheme, () => Promise<{ default: unknown }>> = {
  "github-dark": () => import("shiki/dist/themes/github-dark"), "github-light": () => import("shiki/dist/themes/github-light"), "one-light": () => import("shiki/dist/themes/one-light"), "one-dark-pro": () => import("shiki/dist/themes/one-dark-pro"),
  "dark-plus": () => import("shiki/dist/themes/dark-plus"), "light-plus": () => import("shiki/dist/themes/light-plus"), "dracula": () => import("shiki/dist/themes/dracula"), "nord": () => import("shiki/dist/themes/nord"), "monokai": () => import("shiki/dist/themes/monokai"), "catppuccin-mocha": () => import("shiki/dist/themes/catppuccin-mocha"), "catppuccin-latte": () => import("shiki/dist/themes/catppuccin-latte"), "material-theme-palenight": () => import("shiki/dist/themes/material-theme-palenight"), "min-dark": () => import("shiki/dist/themes/min-dark"), "min-light": () => import("shiki/dist/themes/min-light"), "rose-pine": () => import("shiki/dist/themes/rose-pine"), "rose-pine-dawn": () => import("shiki/dist/themes/rose-pine-dawn"), "tokyo-night": () => import("shiki/dist/themes/tokyo-night"), "vitesse-light": () => import("shiki/dist/themes/vitesse-light"),
};
const themeColors: Record<CodeTheme, { background: string; foreground: string }> = {
  "github-dark": { background: "#24292f", foreground: "#e6edf3" }, "github-light": { background: "#fff", foreground: "#24292f" }, "one-light": { background: "#fafafa", foreground: "#383a42" }, "one-dark-pro": { background: "#282c34", foreground: "#abb2bf" }, "dark-plus": { background: "#1e1e1e", foreground: "#d4d4d4" }, "light-plus": { background: "#fff", foreground: "#000" }, "dracula": { background: "#282a36", foreground: "#f8f8f2" }, "nord": { background: "#2e3440", foreground: "#d8dee9" }, "monokai": { background: "#272822", foreground: "#f8f8f2" }, "catppuccin-mocha": { background: "#1e1e2e", foreground: "#cdd6f4" }, "catppuccin-latte": { background: "#eff1f5", foreground: "#4c4f69" }, "material-theme-palenight": { background: "#292d3e", foreground: "#babed8" }, "min-dark": { background: "#1f1f1f", foreground: "#d4d4d4" }, "min-light": { background: "#fff", foreground: "#383a42" }, "rose-pine": { background: "#191724", foreground: "#e0def4" }, "rose-pine-dawn": { background: "#faf4ed", foreground: "#575279" }, "tokyo-night": { background: "#1a1b26", foreground: "#a9b1d6" }, "vitesse-light": { background: "#ffffff", foreground: "#393a34" },
};

function safeTheme(value: string | null): CodeTheme {
  return THEMES.includes(value as CodeTheme) ? value as CodeTheme : "github-dark";
}

function languageFor(value: string): BundledLanguage | null {
  return LANGUAGES[value.trim()] ?? LANGUAGES[value.trim().toLowerCase()] ?? null;
}

async function loadHighlighter(language: BundledLanguage, theme: CodeTheme) {
  const key = `${language}:${theme}`;
  const cached = highlighterPromise.get(key);
  if (cached) return cached;
  const promise = Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    languageLoaders[language](),
    themeLoaders[theme](),
  ]).then(([core, engine, lang, loadedTheme]) => core.createHighlighterCore({
    langs: [lang.default as never],
    themes: [loadedTheme.default as never],
    engine: engine.createJavaScriptRegexEngine(),
  }));
  highlighterPromise.set(key, promise);
  return promise;
}

export function SolutionCodeView({ code, language }: { code: string; language: string }) {
  const [theme, setTheme] = useState<CodeTheme>(() => safeTheme(globalThis.localStorage?.getItem(THEME_KEY) ?? null));
  const [html, setHtml] = useState<string | null>(null);
  const mappedLanguage = languageFor(language);

  useEffect(() => {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
    let active = true;
    setHtml(null);
    if (!mappedLanguage) return () => { active = false; };
    loadHighlighter(mappedLanguage, theme).then((highlighter) => {
      if (!active) return;
      setHtml(highlighter.codeToHtml(code, { lang: mappedLanguage, theme: theme as BundledTheme }));
    }).catch(() => { if (active) setHtml(null); });
    return () => { active = false; };
  }, [code, mappedLanguage, theme]);

  const colors = themeColors[theme];
  const codeStyle = { "--code-bg": colors.background, "--code-fg": colors.foreground } as CSSProperties;
  return <section className="code-section" aria-label="풀이 코드" style={codeStyle}>
    <div className="code-toolbar">
      <span>코드 보기</span>
      <label>테마<select aria-label="코드 테마" value={theme} onChange={(event) => setTheme(safeTheme(event.target.value))}>
        {THEMES.map((option) => <option key={option} value={option}>{option}</option>)}
      </select></label>
    </div>
    {html ? <>
      <textarea className="code-source-text" aria-label="원문 코드" tabIndex={-1} readOnly value={code} />
      <div className="code-view code-highlight-container" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
    </> : <pre className="code-view"><code>{code}</code></pre>}
  </section>;
}

export { languageFor, safeTheme, THEMES };
