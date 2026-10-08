import { canonicalLanguageKey } from './language'
import type { ProblemDifficulty } from './difficulty'
export type ReconciliationState = 'matched' | 'missing_local' | 'missing_remote' | 'enrichment_available' | 'ambiguous' | 'unsupported'
export type ReconciliationSubmission = {
  submissionId: string; problemNumber: string; language?: string; createdAt?: string; solvedAt?: string;
  executionTime?: number; memoryValue?: number; difficulty?: ProblemDifficulty; sourceDigest?: string
}
export type ReconciliationRecord = {
  captureId: string; platform: string; historicalSubmissionId?: string; problemNumber: string; language: string; solvedAt: string;
  executionTime?: number; memoryValue?: number; difficulty?: ProblemDifficulty; sourceDigest?: string; metadataPending?: boolean
}
export type ReconciliationRow = { submissionId: string; state: ReconciliationState; localCaptureId?: string; remoteCaptureId?: string }
const sameTime = (left?: string, right?: string) => !!left && !!right && Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right)
function compatible(candidate: ReconciliationSubmission, record: ReconciliationRecord) {
  return candidate.problemNumber === record.problemNumber && !!candidate.language && canonicalLanguageKey(candidate.language) === canonicalLanguageKey(record.language)
    && sameTime(candidate.createdAt ?? candidate.solvedAt, record.solvedAt)
    && (!candidate.sourceDigest || !record.sourceDigest || candidate.sourceDigest === record.sourceDigest)
}
/** Metadata report only. Mutation additionally requires selected original-code verification. */
export function reconcileSubmissions(platform: string, candidates: ReconciliationSubmission[], local: ReconciliationRecord[], remote: ReconciliationRecord[], remoteComplete: boolean): ReconciliationRow[] {
  const byId = (records: ReconciliationRecord[]) => {
    const index = new Map<string, ReconciliationRecord[]>()
    for (const record of records) if (record.platform === platform && record.historicalSubmissionId) { const key = record.historicalSubmissionId; index.set(key, [...(index.get(key) ?? []), record]) }
    return index
  }
  const localIndex = byId(local), remoteIndex = byId(remote), counts = new Map<string, number>()
  for (const candidate of candidates) counts.set(candidate.submissionId, (counts.get(candidate.submissionId) ?? 0) + 1)
  const unbound = (records: ReconciliationRecord[]) => new Set(records.filter(record => record.platform === platform && !record.historicalSubmissionId).map(record => `${record.problemNumber}:${canonicalLanguageKey(record.language)}`))
  const localUnbound = unbound(local), remoteUnbound = unbound(remote)
  return candidates.map(candidate => {
    if (!['SWEA', 'PROGRAMMERS'].includes(platform) || !candidate.submissionId || !candidate.language || !Number.isFinite(Date.parse(candidate.createdAt ?? candidate.solvedAt ?? ''))) return { submissionId: candidate.submissionId, state: 'unsupported' }
    const localMatch = localIndex.get(candidate.submissionId) ?? [], remoteMatch = remoteIndex.get(candidate.submissionId) ?? []
    if (counts.get(candidate.submissionId) !== 1 || localMatch.length > 1 || remoteMatch.length > 1 || [...localMatch, ...remoteMatch].some(record => !compatible(candidate, record))) return { submissionId: candidate.submissionId, state: 'ambiguous' }
    const l = localMatch[0], r = remoteMatch[0], identity = { submissionId: candidate.submissionId, localCaptureId: l?.captureId, remoteCaptureId: r?.captureId }
    if (l?.sourceDigest && r?.sourceDigest && l.sourceDigest !== r.sourceDigest) return { ...identity, state: 'ambiguous' }
    if (!l) {
      // A live record without a site submission id is insufficient proof even when code/time resemble the row.
      const key = `${candidate.problemNumber}:${canonicalLanguageKey(candidate.language!)}`, uncertain = localUnbound.has(key) || remoteUnbound.has(key)
      return { ...identity, state: uncertain ? 'ambiguous' : 'missing_local' }
    }
    if (l.metadataPending || (candidate.executionTime != null && l.executionTime == null) || (candidate.memoryValue != null && l.memoryValue == null) || (candidate.difficulty && !l.difficulty)) return { ...identity, state: 'enrichment_available' }
    if (!remoteComplete) return { ...identity, state: 'unsupported' }
    if (!r) {
      const uncertain = remoteUnbound.has(`${candidate.problemNumber}:${canonicalLanguageKey(candidate.language!)}`)
      return { ...identity, state: uncertain ? 'ambiguous' : 'missing_remote' }
    }
    return { ...identity, state: 'matched' }
  })
}
