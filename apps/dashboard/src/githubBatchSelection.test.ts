import { expect, it } from 'vitest'
import { selectGithubBatchRecords, type GithubSelectionMetric } from './githubBatchSelection'
import type { GithubCommitCandidate } from './types'
const record = (id: string, platform: GithubCommitCandidate['platform'] = 'SWEA', state: GithubCommitCandidate['state'] = 'NONE'): GithubCommitCandidate =>
  ({ captureId: id, platform, problemNumber: '1', title: 'Synthetic', language: 'Java', state, solvedAt: `2026-10-${id.padStart(2, '0')}T00:00:00Z` })
const metric = (id: string, executionTime: number | string, memoryValue: number | string, memoryUnit: string): GithubSelectionMetric => ({ captureId: id, platform: 'SWEA', problemNumber: '1', executionTime, memoryValue, memoryUnit })
it('groups by platform and problem, uses newest timestamps, and excludes unsafe states', () => {
  const entries = [record('1'), record('3'), record('2', 'PROGRAMMERS'), ...(['PENDING','RUNNING','SUCCEEDED','UNKNOWN'] as const).map((state, i) => record(String(i+10), 'SWEA', state))]
  expect(selectGithubBatchRecords(entries, 'all').map(item => item.captureId)).toEqual(['1','3','2'])
  expect(selectGithubBatchRecords(entries, 'latest').map(item => item.captureId)).toEqual(['3','2'])
})
it('compares finite runtime and normalized memory while refusing mismatched metadata', () => {
  const entries = [record('1'), record('2'), record('3')]
  const metrics = [metric('1', 5, 1000, 'KB'), metric('2', '3', '1', 'MiB'), metric('3', 10, 0.5, 'MB')]
  expect(selectGithubBatchRecords(entries, 'fastest', metrics)[0]?.captureId).toBe('2')
  expect(selectGithubBatchRecords(entries, 'lowest-memory', metrics)[0]?.captureId).toBe('3')
  expect(selectGithubBatchRecords(entries, 'fastest', [{ ...metric('1', 0, 0, 'MB'), platform: 'PROGRAMMERS' }])[0]?.captureId).toBe('3')
})
it('uses the historical tie policy and newest fallback for missing or invalid measurements', () => {
  const entries = [record('1'), record('2'), record('3', 'SWEA', 'FAILED')]
  expect(selectGithubBatchRecords(entries, 'fastest')[0]?.captureId).toBe('3')
  expect(selectGithubBatchRecords(entries, 'lowest-memory', [metric('1', -1, -1, 'KB'), metric('2', 'NaN', 'Infinity', 'MB')])[0]?.captureId).toBe('3')
  expect(selectGithubBatchRecords(entries, 'fastest', entries.map(item => metric(item.captureId, 1, 2, 'MB')))[0]?.captureId).toBe('3')
})
