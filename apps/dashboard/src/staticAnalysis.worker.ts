import { analyzeSource, MAX_ANALYSIS_LENGTH } from './staticAnalysis'
const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (value: unknown) => void }
scope.onmessage = event => {
  const request = event.data
  if (!request || typeof request.id !== 'number' || typeof request.language !== 'string' || request.language.length > 100 || typeof request.source !== 'string' || request.source.length > MAX_ANALYSIS_LENGTH) return
  scope.postMessage({ id: request.id, result: analyzeSource(request.language, request.source) })
}
