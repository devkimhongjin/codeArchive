import { ANALYZER_VERSION, MAX_ANALYSIS_LENGTH, analysisLanguage, emptyAnalysis, type AnalysisResult } from './staticAnalysisContract'
type AnalysisWorker = { onmessage: ((event: MessageEvent) => unknown) | null; onerror: ((event: ErrorEvent) => unknown) | null; postMessage: (value: unknown) => void; terminate: () => void }
const CACHE_KEY = 'codearchive.static-analysis.results.v1'
const MAX_CACHE_ENTRIES = 30
const memory = new Map<string, AnalysisResult>()
export function clearStaticAnalysisCache() { memory.clear(); try { localStorage.removeItem(CACHE_KEY) } catch { /* Storage unavailable. */ } }
let requestId = 0
const statuses = new Set(['success', 'syntax_error', 'unsupported', 'limit', 'timeout', 'failed'])
export function validAnalysis(value: unknown): value is AnalysisResult {
  if (!value || typeof value !== 'object') return false
  const result = value as AnalysisResult
  return result.version === ANALYZER_VERSION && statuses.has(result.status) && (result.language === null || ['java', 'javascript', 'typescript', 'python'].includes(result.language)) && Array.isArray(result.diagnostics) && result.diagnostics.length <= 200 && result.diagnostics.every(item =>
    !!item && ['warning', 'error'].includes(item.severity) && Number.isInteger(item.line) && item.line > 0 && Number.isInteger(item.column) && item.column > 0 && typeof item.rule === 'string' && item.rule.length <= 50 && typeof item.message === 'string' && item.message.length <= 200)
}
function readCache(key: string): AnalysisResult | undefined {
  const inMemory = memory.get(key)
  if (inMemory) return inMemory
  try {
    const text = localStorage.getItem(CACHE_KEY)
    if (!text || text.length > 1000000) return
    const entries: unknown = JSON.parse(text)
    if (!Array.isArray(entries)) return
    const item = entries.slice(-MAX_CACHE_ENTRIES).find(entry => Array.isArray(entry) && entry[0] === key && validAnalysis(entry[1]))
    if (item) return item[1]
  } catch { /* Storage may be unavailable; analysis still works. */ }
}
function writeCache(key: string, result: AnalysisResult) {
  if (!['success', 'syntax_error'].includes(result.status)) return
  memory.delete(key); memory.set(key, result)
  while (memory.size > MAX_CACHE_ENTRIES) memory.delete(memory.keys().next().value!)
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...memory])) } catch { /* Quota does not invalidate the result. */ }
}
export async function runStaticAnalysis(languageValue: string, source: string, options: {
  signal?: AbortSignal; timeoutMs?: number; workerFactory?: () => AnalysisWorker
} = {}): Promise<{ result: AnalysisResult; cached: boolean }> {
  const language = analysisLanguage(languageValue), signal = options.signal
  const aborted = () => { if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError') }
  aborted()
  if (!language) return { result: emptyAnalysis(null, 'unsupported'), cached: false }
  if (source.length > MAX_ANALYSIS_LENGTH) return { result: emptyAnalysis(language, 'limit'), cached: false }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ANALYZER_VERSION}\0${language}\0${source}`))
  aborted()
  const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const cached = readCache(key)
  if (cached && cached.language === language) return { result: cached, cached: true }
  const id = ++requestId
  return new Promise((resolve, reject) => {
    let worker: AnalysisWorker
    try { worker = options.workerFactory ? options.workerFactory() : new Worker(new URL('./staticAnalysis.worker.ts', import.meta.url), { type: 'module' }) }
    catch { resolve({ result: emptyAnalysis(language, 'failed'), cached: false }); return }
    let finished = false
    const cleanup = () => { worker.terminate(); clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
    const finish = (result: AnalysisResult) => { if (finished) return; finished = true; cleanup(); writeCache(key, result); resolve({ result, cached: false }) }
    const cancel = () => { if (finished) return; finished = true; cleanup(); reject(new DOMException('Analysis cancelled', 'AbortError')) }
    const timer = setTimeout(() => finish(emptyAnalysis(language, 'timeout')), Math.max(1, Math.min(10000, options.timeoutMs ?? 5000)))
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onmessage = event => {
      if (event.data?.id !== id) return
      const result = event.data.result
      finish(validAnalysis(result) && result.language === language ? result : emptyAnalysis(language, 'failed'))
    }
    worker.onerror = () => finish(emptyAnalysis(language, 'failed'))
    if (signal?.aborted) { cancel(); return }
    try { worker.postMessage({ id, language, source }) } catch { finish(emptyAnalysis(language, 'failed')) }
  })
}
