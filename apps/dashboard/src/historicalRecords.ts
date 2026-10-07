import type { HistoricalRecord, Platform } from './types'

export const HISTORY_PLATFORMS: Platform[] = ['JUNGOL', 'SWEA', 'PROGRAMMERS']
export const historyPlatformLabel: Record<Platform, string> = { JUNGOL: '정올', SWEA: 'SWEA', PROGRAMMERS: '프로그래머스' }
export const historyKey = (record: HistoricalRecord) => `${record.platform}:${record.historicalSubmissionId}`
export const historyProblemCount = (records: HistoricalRecord[]) => new Set(records.map(record => `${record.platform}:${record.problemNumber}`)).size
export function isHistoricalRecord(value: unknown): value is HistoricalRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as HistoricalRecord
  return HISTORY_PLATFORMS.includes(record.platform) && typeof record.captureId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.captureId) &&
    typeof record.historicalSubmissionId === 'string' && record.historicalSubmissionId.length > 0 && record.historicalSubmissionId.length <= 320 &&
    typeof record.problemNumber === 'string' && typeof record.title === 'string' && typeof record.language === 'string'
}
