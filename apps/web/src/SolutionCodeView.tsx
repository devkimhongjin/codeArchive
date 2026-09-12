import { useEffect, useState } from "react";
import type { BundledLanguage, BundledTheme } from "shiki";

const THEME_KEY = "codearchive.code-theme";
const THEMES = ["github-dark", "github-light", "one-dark-pro"] as const;
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
  "github-dark": () => import("shiki/dist/themes/github-dark"), "github-light": () => import("shiki/dist/themes/github-light"), "one-dark-pro": () => import("shiki/dist/themes/one-dark-pro"),
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

  return <section className="code-section" aria-label="풀이 코드">
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
