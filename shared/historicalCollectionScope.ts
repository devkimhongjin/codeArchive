export type HistoricalCollectionScope = {
  batchId: string
  platform: 'JUNGOL' | 'SWEA' | 'PROGRAMMERS'
  submissionIds: string[]
}
export type HistoricalCollectionNotice = {
  type: 'CODEARCHIVE_HISTORY_COLLECTION'
  scope: HistoricalCollectionScope | null
}
export function isHistoricalCollectionScope(value: unknown): value is HistoricalCollectionScope {
  if (!value || typeof value !== 'object') return false
  const scope = value as HistoricalCollectionScope
  return typeof scope.batchId === 'string' && /^[A-Z]+:[0-9]{1,16}$/.test(scope.batchId) &&
    ['JUNGOL', 'SWEA', 'PROGRAMMERS'].includes(scope.platform) && scope.batchId.startsWith(`${scope.platform}:`) &&
    Array.isArray(scope.submissionIds) && scope.submissionIds.length > 0 && scope.submissionIds.length <= 5000 &&
    scope.submissionIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 320 && !/[\x00-\x1f\x7f]/.test(id)) &&
    new Set(scope.submissionIds).size === scope.submissionIds.length
}
export function isHistoricalCollectionNotice(value: unknown): value is HistoricalCollectionNotice {
  return !!value && typeof value === 'object' && (value as HistoricalCollectionNotice).type === 'CODEARCHIVE_HISTORY_COLLECTION' &&
    ((value as HistoricalCollectionNotice).scope === null || isHistoricalCollectionScope((value as HistoricalCollectionNotice).scope))
}
export function belongsToCollection(record: { platform: string; historicalSubmissionId?: string }, scope: HistoricalCollectionScope): boolean {
  return record.platform === scope.platform && typeof record.historicalSubmissionId === 'string' && scope.submissionIds.includes(record.historicalSubmissionId)
}

export const HISTORICAL_COLLECTION_REQUEST = 'CODEARCHIVE_HISTORY_COLLECTION_REQUEST'
export function isTrustedHistoricalCollectionRequest(event: { source: unknown; origin: string; data: unknown }, parent: unknown, origin: string): boolean {
  return parent != null && event.source === parent && event.origin === origin && !!event.data &&
    typeof event.data === 'object' && (event.data as { type?: unknown }).type === HISTORICAL_COLLECTION_REQUEST
}
