export const ANALYZER_VERSION = 'basic-1/babel-8.0.7/java-3.0.1/python-1.1.19'
export const MAX_ANALYSIS_LENGTH = 262144
export type AnalysisLanguage = 'java' | 'javascript' | 'typescript' | 'python'
export type AnalysisDiagnostic = { rule: string; severity: 'warning' | 'error'; line: number; column: number; message: string }
export type AnalysisResult = { version: string; status: 'success' | 'syntax_error' | 'unsupported' | 'limit' | 'timeout' | 'failed'; language: AnalysisLanguage | null; diagnostics: AnalysisDiagnostic[] }
export function analysisLanguage(value: string): AnalysisLanguage | null {
  const language = value.toLowerCase().trim()
  if (/python|pypy/.test(language)) return 'python'
  if (/typescript|^ts$/.test(language)) return 'typescript'
  if (/javascript|^js$|node/.test(language)) return 'javascript'
  if (/^java(?:\s|\d|$)/.test(language)) return 'java'
  return null
}
export function emptyAnalysis(language: AnalysisLanguage | null, status: AnalysisResult['status']): AnalysisResult {
  return { version: ANALYZER_VERSION, status, language, diagnostics: [] }
}
