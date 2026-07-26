export const ENTITY_NAMESPACES = [
  'problem',
  'solution-session',
  'submission',
  'ai-usage',
] as const

export type EntityNamespace = (typeof ENTITY_NAMESPACES)[number]
export type EntityId = `${EntityNamespace}:${string}`
export type ProblemId = `problem:${string}`
export type SolutionSessionId = `solution-session:${string}`
export type SubmissionId = `submission:${string}`
export type AIUsageRecordId = `ai-usage:${string}`

export type UtcTimestamp = string
export type CalendarDate = string

export const PLATFORMS = ['swea', 'programmers', 'jungol', 'leetcode'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PROGRAMMING_LANGUAGES = [
  'java',
  'python',
  'c',
  'cpp',
  'javascript',
  'typescript',
  'kotlin',
  'csharp',
  'go',
  'swift',
  'rust',
] as const
export type ProgrammingLanguage = (typeof PROGRAMMING_LANGUAGES)[number]

export const RECORD_SOURCES = [
  'auto-captured',
  'manual',
  'source-file',
  'markdown-import',
  'json-import',
  'github-import',
  'notion-import',
  'platform-history',
] as const
export type RecordSource = (typeof RECORD_SOURCES)[number]

export const SUBMISSION_RESULTS = [
  'accepted',
  'wrong-answer',
  'compile-error',
  'runtime-error',
  'time-limit-exceeded',
  'memory-limit-exceeded',
  'presentation-error',
  'other',
  'unknown',
] as const
export type SubmissionResult = (typeof SUBMISSION_RESULTS)[number]

export const AI_USAGE_LEVELS = [
  'none',
  'concept-only',
  'partial-hint',
  'solution-direction',
  'partial-code',
  'full-solution',
  'ai-led-study',
  'unrecorded',
] as const
export type AIUsageLevel = (typeof AI_USAGE_LEVELS)[number]

export const AI_USAGE_PURPOSES = [
  'syntax',
  'library-usage',
  'algorithm-concept',
  'algorithm-recommendation',
  'approach-check',
  'counterexample',
  'error-analysis',
  'compile-error',
  'runtime-error',
  'time-optimization',
  'memory-optimization',
  'readability',
  'refactoring',
  'time-complexity',
  'space-complexity',
  'test-generation',
  'full-solution-generation',
  'solution-explanation',
  'review-explanation',
] as const
export type AIUsagePurpose = (typeof AI_USAGE_PURPOSES)[number]

export const AI_CONTRIBUTION_RATES = [
  '0',
  '1-25',
  '26-50',
  '51-75',
  '76-99',
  '100',
  'unknown',
] as const
export type AIContributionRate = (typeof AI_CONTRIBUTION_RATES)[number]

export const UNDERSTANDING_LEVELS = [
  'none',
  'partial',
  'full-flow',
  'can-explain',
  'can-apply',
] as const
export type UnderstandingLevel = (typeof UNDERSTANDING_LEVELS)[number]

export const SOLVABLE_WITHOUT_AI_VALUES = [
  'now',
  'with-hint',
  'after-review',
  'retry-required',
  'not-yet',
  'unchecked',
] as const
export type SolvableWithoutAI = (typeof SOLVABLE_WITHOUT_AI_VALUES)[number]

export const EXPLANATION_ABILITIES = [
  'line-by-line',
  'core-logic',
  'concept-only',
  'difficult',
] as const
export type ExplanationAbility = (typeof EXPLANATION_ABILITIES)[number]

export interface Problem {
  schemaVersion: 1
  id: ProblemId
  platform: Platform
  platformProblemId?: string
  problemNumber?: string
  title?: string
  url?: string
  difficulty?: string
  tags: string[]
  source: RecordSource
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}

export interface SolutionSession {
  schemaVersion: 1
  id: SolutionSessionId
  problemId: ProblemId
  language: ProgrammingLanguage
  result: SubmissionResult
  code?: string
  solvedAt?: UtcTimestamp
  summary?: string
  approach?: string
  timeComplexity?: string
  spaceComplexity?: string
  mistakes: string[]
  reviewRequired: boolean
  reviewDate?: CalendarDate
  source: RecordSource
  githubFilePath?: string
  codeHash?: string
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}

export interface Submission {
  schemaVersion: 1
  id: SubmissionId
  solutionSessionId: SolutionSessionId
  platformSubmissionId?: string
  result: SubmissionResult
  language: ProgrammingLanguage
  code?: string
  executionTimeMs?: number
  memoryKiB?: number
  submittedAt: UtcTimestamp
  source: RecordSource
  createdAt: UtcTimestamp
}

export interface AIUsageRecord {
  schemaVersion: 1
  id: AIUsageRecordId
  solutionSessionId: SolutionSessionId
  level: AIUsageLevel
  purposes: AIUsagePurpose[]
  provider?: string
  model?: string
  promptSummary?: string
  referencedContent?: string
  contributionRate?: AIContributionRate
  copiedDirectly?: boolean
  modifiedAfterUse?: boolean
  understandingLevel?: UnderstandingLevel
  solvableWithoutAI?: SolvableWithoutAI
  explanationAbility?: ExplanationAbility
  reviewRequired: boolean
  recordedAt: UtcTimestamp
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}

export interface CoreDataAggregate {
  problems: Problem[]
  solutionSessions: SolutionSession[]
  submissions: Submission[]
  aiUsageRecords: AIUsageRecord[]
}

export type ValidationIssueCode =
  | 'invalid_type'
  | 'missing_required'
  | 'unknown_field'
  | 'invalid_enum'
  | 'invalid_format'
  | 'invalid_relation'
  | 'unsupported_schema_version'

export interface ValidationIssue {
  path: string
  code: ValidationIssueCode
  message: string
}

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; issues: ValidationIssue[] }

export interface DuplicateCandidateKey {
  field:
    | 'platformProblemId'
    | 'problemNumber'
    | 'url'
    | 'title'
    | 'githubFilePath'
    | 'codeHash'
  strength: 'strong' | 'weak'
  value: string
}

export type DuplicateComparison =
  | {
      kind: 'none'
      matchingKeys: []
      autoMerge: false
    }
  | {
      kind: 'candidate'
      strength: 'strong' | 'weak'
      matchingKeys: DuplicateCandidateKey[]
      autoMerge: false
    }
  | {
      kind: 'duplicate_conflict'
      matchingKeys: DuplicateCandidateKey[]
      conflictingFields: string[]
      autoMerge: false
    }

const ID_NAMESPACE_BY_ENTITY = {
  problem: 'problem',
  solutionSession: 'solution-session',
  submission: 'submission',
  aiUsageRecord: 'ai-usage',
} as const

export function createEntityId(
  entity: 'problem',
  randomUuid?: () => string,
): ProblemId
export function createEntityId(
  entity: 'solutionSession',
  randomUuid?: () => string,
): SolutionSessionId
export function createEntityId(
  entity: 'submission',
  randomUuid?: () => string,
): SubmissionId
export function createEntityId(
  entity: 'aiUsageRecord',
  randomUuid?: () => string,
): AIUsageRecordId
export function createEntityId(
  entity: keyof typeof ID_NAMESPACE_BY_ENTITY,
  randomUuid: () => string = () => crypto.randomUUID(),
): EntityId {
  return `${ID_NAMESPACE_BY_ENTITY[entity]}:${randomUuid()}`
}

export function createUtcTimestamp(now: Date = new Date()): UtcTimestamp {
  return now.toISOString()
}
