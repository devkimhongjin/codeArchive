import { parse as parseScript } from '@babel/parser'
import { parser as pythonParser } from '@lezer/python'
import { lexAndParse } from 'java-parser'

import { ANALYZER_VERSION, MAX_ANALYSIS_LENGTH, analysisLanguage, emptyAnalysis, type AnalysisDiagnostic, type AnalysisResult } from './staticAnalysisContract'
export * from './staticAnalysisContract'
/** Parse text only. Never evaluate, compile, import or execute submitted code. */
export function analyzeSource(languageValue: string, source: string): AnalysisResult {
  const language = analysisLanguage(languageValue)
  if (!language) return emptyAnalysis(null, 'unsupported')
  if (typeof source !== 'string' || source.length > MAX_ANALYSIS_LENGTH) return emptyAnalysis(language, 'limit')
  const diagnostics: AnalysisDiagnostic[] = []
  const add = (rule: string, line: number, column: number, message: string, severity: AnalysisDiagnostic['severity'] = 'warning') => {
    if (diagnostics.length < 200) diagnostics.push({ rule, severity, line: Number.isFinite(line) && line > 0 ? line : 1, column: Number.isFinite(column) && column > 0 ? column : 1, message })
  }
  let nodes = 0
  try {
    if (language === 'javascript' || language === 'typescript') {
      const ast = parseScript(source, { sourceType: 'unambiguous', plugins: language === 'typescript' ? ['typescript'] : [] })
      const stack: unknown[] = [ast]
      while (stack.length) {
        if (++nodes > 100000) return emptyAnalysis(language, 'limit')
        const value = stack.pop()
        if (!value || typeof value !== 'object') continue
        const node = value as Record<string, any>, line = node.loc?.start?.line ?? 1, column = (node.loc?.start?.column ?? 0) + 1
        if (node.type === 'VariableDeclaration' && node.kind === 'var') add('js/no-var', line, column, 'var 대신 let 또는 const 사용을 검토하세요.')
        if (node.type === 'BinaryExpression' && ['==', '!='].includes(node.operator)) add('js/strict-equality', line, column, '암시적 형 변환을 피하려면 엄격한 동등 비교를 검토하세요.')
        if (node.type === 'DebuggerStatement') add('js/no-debugger', line, column, '제출 코드에 debugger가 남아 있습니다.')
        if (node.type === 'CatchClause' && node.body?.body?.length === 0) add('js/empty-catch', line, column, '빈 catch가 오류를 숨길 수 있습니다.')
        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'eval') add('js/no-eval', line, column, 'eval 호출 대신 명시적인 처리를 검토하세요.')
        for (const [key, child] of Object.entries(node)) {
          if (['loc', 'start', 'end', 'comments', 'tokens', 'extra'].includes(key)) continue
          if (Array.isArray(child)) stack.push(...child)
          else if (child && typeof child === 'object') stack.push(child)
        }
      }
    } else if (language === 'java') {
      const { cst } = lexAndParse(source)
      const stack = [cst]
      while (stack.length) {
        if (++nodes > 100000) return emptyAnalysis(language, 'limit')
        const node = stack.pop()!
        if (node.name === 'catchClause') {
          const block = node.children.block?.[0]
          if (block && 'children' in block && !(block.children as Record<string, unknown>).blockStatements) add('java/empty-catch', node.location.startLine, node.location.startColumn, '빈 catch가 예외를 숨길 수 있습니다.')
        }
        for (const children of Object.values(node.children)) for (const child of children) if ('children' in child) stack.push(child)
      }
    } else {
      const tree = pythonParser.parse(source), cursor = tree.cursor()
      const starts = [0]
      for (let index = 0; index < source.length; index++) if (source[index] === '\n') starts.push(index + 1)
      const position = (offset: number) => {
        let low = 0, high = starts.length
        while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (starts[middle] <= offset) low = middle; else high = middle }
        return [low + 1, offset - starts[low] + 1]
      }
      do {
        if (++nodes > 100000) return emptyAnalysis(language, 'limit')
        const [line, column] = position(cursor.from)
        if (cursor.type.isError) add('syntax', line, column, '문법을 확인하세요. 지원 문법 범위에 없는 구문일 수도 있습니다.', 'error')
        if (cursor.name === 'except' && cursor.node.nextSibling?.name === 'Body') add('python/bare-except', line, column, 'except에 처리할 예외 유형을 지정하는 것을 검토하세요.')
      } while (cursor.next())
    }
  } catch (error) {
    // Parser messages can include submitted source. Return only fixed wording and numeric locations.
    const value = error as { loc?: { line?: number; column?: number }; message?: string }
    const javaLocation = language === 'java' ? /line: (\d+), column: (\d+)/.exec(value.message ?? '') : null
    add('syntax', value.loc?.line ?? Number(javaLocation?.[1] ?? 1), value.loc?.column != null ? value.loc.column + 1 : Number(javaLocation?.[2] ?? 1), '문법을 확인하세요. 지원 문법 범위에 없는 구문일 수도 있습니다.', 'error')
  }
  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule))
  return { version: ANALYZER_VERSION, language, status: diagnostics.some(item => item.severity === 'error') ? 'syntax_error' : 'success', diagnostics }
}
