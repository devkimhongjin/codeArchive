import { selectHistoricalSubmissionIds, type HistoricalSelectionMode } from '../../../shared/historicalSelection'
import type { GithubCommitCandidate, Solution } from './types'

export type GithubSelectionMetric = Pick<Solution, 'captureId' | 'platform' | 'problemNumber' | 'executionTime' | 'memoryValue' | 'memoryUnit'>
const number = (value: unknown) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
const bytes = (metric?: GithubSelectionMetric) => {
  const value = number(metric?.memoryValue)
  const unit = { KB: 1000, KiB: 1024, MB: 1_000_000, MiB: 1_048_576 }[metric?.memoryUnit as 'KB']
  return value === undefined || !unit || !Number.isFinite(value * unit) ? undefined : value * unit
}

/** Restrict the same historical selection policy to uncommitted server records. */
export function selectGithubBatchRecords(records: GithubCommitCandidate[], mode: HistoricalSelectionMode, metrics: GithubSelectionMetric[] = []) {
  const eligible = records.filter(record => record.state === 'NONE' || record.state === 'FAILED')
  if (mode === 'all') return eligible
  const byId = new Map(metrics.map(metric => [metric.captureId, metric]))
  const timestamp = (record: GithubCommitCandidate) => {
    const time = Date.parse(record.solvedAt ?? '')
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
  }
  const sorted = [...eligible].sort((left, right) => timestamp(left) > timestamp(right) ? -1 : timestamp(left) < timestamp(right) ? 1 : 0)
  const ids = new Set(selectHistoricalSubmissionIds(sorted.map(record => {
    const value = byId.get(record.captureId)
    const metric = value?.platform === record.platform && value.problemNumber === record.problemNumber ? value : undefined
    return { submissionId: record.captureId, problemNumber: `${record.platform}:${record.problemNumber}`,
      executionTime: number(metric?.executionTime), memoryValue: bytes(metric) }
  }), mode))
  return eligible.filter(record => ids.has(record.captureId))
}
