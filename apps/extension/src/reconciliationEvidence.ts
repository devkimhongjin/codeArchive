import type { CaptureStore } from './storage'
import type { ReconciliationRecord } from '../../../shared/submissionReconciliation'
import { normalizeDifficulty } from '../../../shared/difficulty'
const API_ORIGIN = 'https://codearchive-dashboard-beta.netlify.app'
export type ReconciliationEvidence = { local: ReconciliationRecord[]; remote: ReconciliationRecord[]; localComplete: boolean; remoteComplete: boolean; serverReason?: string }
type User = { id: number; githubId: string }
export async function loadReconciliationEvidence(store: Pick<CaptureStore, 'listAll' | 'getSettings'>, platform: 'SWEA' | 'PROGRAMMERS', fetcher: typeof fetch = fetch): Promise<ReconciliationEvidence> {
  const result: ReconciliationEvidence = { local: [], remote: [], localComplete: false, remoteComplete: false }
  const all = await store.listAll(), captures = all.filter(capture => capture.platform === platform)
  if (captures.length > 5000 || captures.reduce((bytes, capture) => bytes + capture.sourceCode.length, 0) > 16000000) return { ...result, serverReason: 'LOCAL_LIMIT' }
  for (const capture of captures) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capture.sourceCode))
    result.local.push({ captureId: capture.captureId, platform, historicalSubmissionId: capture.historicalSubmissionId,
      problemNumber: capture.problemNumber, language: capture.language, solvedAt: capture.solvedAt,
      executionTime: capture.executionTime, memoryValue: capture.memoryValue,
      difficulty: normalizeDifficulty(platform, capture.problemNumber, capture.problemUrl, capture.difficulty),
      metadataPending: capture.metadataPending, sourceDigest: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
  }
  result.localComplete = true
  const account = (await store.getSettings()).accountId
  if (!account) return { ...result, serverReason: 'LOGIN_REQUIRED' }
  const request = async (path: string, githubId?: string) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetcher(`${API_ORIGIN}${path}`, { credentials: 'include', redirect: 'error', signal: controller.signal, headers: githubId ? { 'X-CodeArchive-Account': githubId } : {} })
      if (!response.ok) throw new Error('RESPONSE_UNAVAILABLE')
      const text = await response.text()
      if (text.length > 500000) throw new Error('RESPONSE_LIMIT')
      return JSON.parse(text)
    } finally { clearTimeout(timer) }
  }
  const validUser = (value: unknown): value is User => !!value && typeof value === 'object' && Number.isSafeInteger((value as User).id) && (value as User).id > 0 && typeof (value as User).githubId === 'string' && /^\d{1,40}$/.test((value as User).githubId)
  try {
    const initial = await request('/api/auth/me')
    if (!validUser(initial) || String(initial.id) !== account) return { ...result, serverReason: 'ACCOUNT_CHANGED' }
    const remote: ReconciliationRecord[] = [], seen = new Set<string>(); let cursor = 0, complete = false
    for (let page = 0; page < 100; page++) {
      if ((await store.getSettings()).accountId !== account) throw new Error('ACCOUNT_CHANGED')
      const response = await request(`/api/solutions/reconciliation-records?platform=${platform}&cursor=${cursor}`, initial.githubId)
      if (!response || !Array.isArray(response.records) || response.records.length > 50 || !Number.isSafeInteger(response.cursor) || response.cursor < cursor || typeof response.hasMore !== 'boolean' || (response.hasMore && response.cursor <= cursor)) throw new Error('RESPONSE_INVALID')
      for (const record of response.records) {
        if (!validReconciliationRecord(record, platform) || seen.has(record.captureId)) throw new Error('RESPONSE_INVALID')
        seen.add(record.captureId); remote.push(record)
      }
      cursor = response.cursor
      if (!response.hasMore) { complete = true; break }
    }
    const confirmed = await request('/api/auth/me')
    if ((await store.getSettings()).accountId !== account || !validUser(confirmed) || confirmed.id !== initial.id || confirmed.githubId !== initial.githubId) throw new Error('ACCOUNT_CHANGED')
    if (!complete) return { ...result, serverReason: 'SERVER_LIMIT' }
    return { ...result, remote, remoteComplete: true }
  } catch { return { ...result, remote: [], remoteComplete: false, serverReason: 'SERVER_UNAVAILABLE' } }
}
export function validReconciliationRecord(value: unknown, platform: string): value is ReconciliationRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as ReconciliationRecord
  return record.platform === platform && typeof record.captureId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.captureId) && typeof record.problemNumber === 'string' && /^\d{1,40}$/.test(record.problemNumber) && typeof record.language === 'string' && record.language.length > 0 && record.language.length <= 100 && typeof record.solvedAt === 'string' && Number.isFinite(Date.parse(record.solvedAt)) && typeof record.sourceDigest === 'string' && /^[0-9a-f]{64}$/.test(record.sourceDigest) && (record.historicalSubmissionId == null || typeof record.historicalSubmissionId === 'string' && record.historicalSubmissionId.length <= 320)
}
