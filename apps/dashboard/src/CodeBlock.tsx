import { useEffect, useState } from 'react'
import type { ThemedToken } from 'shiki'
import { sourceFileExtension } from './codeExport'

let highlighter: ReturnType<typeof loadHighlighter> | undefined
async function loadHighlighter() {
  const { createHighlighterCore } = await import('shiki/core')
  const { createOnigurumaEngine } = await import('shiki/engine/oniguruma')
  return createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs')],
    langs: [import('shiki/langs/java.mjs'), import('shiki/langs/python.mjs'), import('shiki/langs/cpp.mjs'), import('shiki/langs/c.mjs'), import('shiki/langs/javascript.mjs'), import('shiki/langs/typescript.mjs'), import('shiki/langs/kotlin.mjs'), import('shiki/langs/csharp.mjs'), import('shiki/langs/sql.mjs')],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })
}
export function highlightLanguage(language: string) {
  return ({ py: 'python', js: 'javascript', ts: 'typescript', kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', java: 'java', sql: 'sql' } as Record<string, string>)[sourceFileExtension(language)] ?? 'text'
}
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [result, setResult] = useState<{ code: string; language: string; tokens: ThemedToken[][] } | null>(null)
  useEffect(() => {
    let active = true
    highlighter ??= loadHighlighter().catch(error => { highlighter = undefined; throw error })
    void highlighter.then(engine => {
      const tokens = engine.codeToTokens(code, { lang: highlightLanguage(language), theme: 'github-light' }).tokens
      if (active) setResult({ code, language, tokens })
    }).catch(() => { if (active) setResult(null) })
    return () => { active = false }
  }, [code, language])
  const tokens = result?.code === code && result.language === language ? result.tokens : null
  const lines = code.split('\n')
  return <div className="code-viewer" role="region" aria-label="소스 코드">
    <div className="code-gutter" aria-hidden="true">{lines.map((_, index) => <span key={index}>{String(index + 1).padStart(2, '0')}</span>)}</div>
    <pre><code>{lines.map((line, index) => <span className="code-line" key={index}><span className="code-content">{tokens?.[index] ? tokens[index].map((token, i) => <span key={i} style={{ color: token.color, fontStyle: token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined, fontWeight: token.fontStyle && token.fontStyle & 2 ? 'bold' : undefined }}>{token.content}</span>) : line}</span>{index < lines.length - 1 ? '\n' : ''}</span>)}</code></pre>
  </div>
}
