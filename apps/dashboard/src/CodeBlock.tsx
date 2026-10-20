import { bundledThemes } from "shiki/themes"
import { useEffect, useState } from 'react'
import type { ThemedToken } from 'shiki'
import { describeLanguage } from '../../../shared/language'
import { DARK_THEMES, LIGHT_THEMES, type DarkTheme, type LightTheme } from './types'
import { isDarkTheme, isLightTheme, type CodeTheme, type CodeThemeMode } from '../../../shared/codeThemes'

// Each grammar is fetched only when code in that language is shown. Loading
// all fourteen at once pulled ~2.5MB (cpp alone is ~800kB) into every viewer.
const grammars: Record<string, () => Promise<{ default: unknown }>> = {
  java: () => import('shiki/langs/java.mjs'), python: () => import('shiki/langs/python.mjs'), cpp: () => import('shiki/langs/cpp.mjs'),
  c: () => import('shiki/langs/c.mjs'), javascript: () => import('shiki/langs/javascript.mjs'), typescript: () => import('shiki/langs/typescript.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'), csharp: () => import('shiki/langs/csharp.mjs'), sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'), rust: () => import('shiki/langs/rust.mjs'), ruby: () => import('shiki/langs/ruby.mjs'),
  swift: () => import('shiki/langs/swift.mjs'), scala: () => import('shiki/langs/scala.mjs'),
}
let highlighter: ReturnType<typeof loadHighlighter> | undefined
async function loadHighlighter() {
  const { createHighlighterCore } = await import('shiki/core')
  const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript')
  return createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine() })
}
async function ensureLanguage(engine: Awaited<ReturnType<typeof loadHighlighter>>, lang: string): Promise<string> {
  const grammar = grammars[lang]
  if (!grammar) return 'text'
  if (!engine.getLoadedLanguages().includes(lang)) await engine.loadLanguage((await grammar()).default as Parameters<typeof engine.loadLanguage>[0])
  return lang
}
export function highlightLanguage(language: string) {
  return describeLanguage(language).shikiLanguage ?? 'text'
}
export function CodeThemeSelect({ value, onChange, id }: { value: CodeTheme; onChange: (theme: CodeTheme) => void; id?: string }) {
  return <select id={id} aria-label="코드 보기 테마" value={value} onChange={event => {
    const theme = event.target.value
    if (isLightTheme(theme) || isDarkTheme(theme)) onChange(theme)
  }}>
    <optgroup label="밝은 테마">{LIGHT_THEMES.map(theme => <option key={theme} value={theme}>{theme}</option>)}</optgroup>
    <optgroup label="어두운 테마">{DARK_THEMES.map(theme => <option key={theme} value={theme}>{theme}</option>)}</optgroup>
  </select>
}

export function CodeBlock({ code, language, lightTheme = 'github-light', darkTheme = 'github-dark', activeMode, onThemeChange }: { code: string; language: string; lightTheme?: LightTheme; darkTheme?: DarkTheme; activeMode?: CodeThemeMode; onThemeChange?: (theme: CodeTheme) => void }) {
  const [result, setResult] = useState<{ code: string; language: string; theme: string; tokens: ThemedToken[][]; foreground?: string; background?: string } | null>(null)
  const dark = activeMode === 'dark' || (activeMode === undefined && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const theme = dark ? darkTheme : lightTheme
  useEffect(() => {
    let active = true
    highlighter ??= loadHighlighter().catch(error => { highlighter = undefined; throw error })
    void highlighter.then(async engine => {
      if (!engine.getLoadedThemes().includes(theme)) await engine.loadTheme(bundledThemes[theme]())
      const lang = await ensureLanguage(engine, highlightLanguage(language))
      const tokens = engine.codeToTokens(code, { lang, theme }).tokens
      const palette = engine.getTheme(theme) as { fg?: string; bg?: string }
      if (active) setResult({ code, language, theme, tokens, foreground: palette.fg, background: palette.bg })
    }).catch(() => { if (active) setResult(null) })
    return () => { active = false }
  }, [code, language, theme])
  const highlighted = result?.code === code && result.language === language && result.theme === theme ? result : null
  const tokens = highlighted?.tokens ?? null
  const lines = code.split('\n')
  return <>
    {onThemeChange && <div className="code-theme-controls"><label>테마 <CodeThemeSelect value={theme} onChange={onThemeChange} /></label></div>}
    <div className="code-viewer" role="region" aria-label="소스 코드" data-shiki-theme={highlighted?.theme} style={{ backgroundColor: highlighted?.background, color: highlighted?.foreground, colorScheme: dark ? 'dark' : 'light' }}>
      <div className="code-gutter" aria-hidden="true" style={{ color: highlighted?.foreground }}>{lines.map((_, index) => <span className="code-gutter-line" key={index}>{index + 1}</span>)}</div>
      <pre style={{ backgroundColor: highlighted?.background, color: highlighted?.foreground }}><code>{lines.map((line, index) => <span className="code-line" key={index}><span className="code-content">{tokens?.[index] ? tokens[index].map((token, i) => <span key={i} style={{ color: token.color, fontStyle: token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined, fontWeight: token.fontStyle && token.fontStyle & 2 ? 'bold' : undefined }}>{token.content}</span>) : line}</span>{index < lines.length - 1 ? '\n' : ''}</span>)}</code></pre>
    </div>
  </>
}
