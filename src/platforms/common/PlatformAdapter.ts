import type {
  Platform,
  ProgrammingLanguage,
  SubmissionResult,
} from '../../common/types'

export const ADAPTER_FAILURE_CODES = [
  'unsupported-url',
  'missing-required-element',
  'code-unavailable',
  'language-unresolved',
  'submission-observer-unavailable',
  'dom-contract-changed',
  'invalid-captured-data',
] as const

export type AdapterFailureCode = (typeof ADAPTER_FAILURE_CODES)[number]

export type AdapterStage =
  'detect' | 'problem' | 'solution' | 'language' | 'submission'

export type AdapterFallback = 'retry' | 'manual-entry' | 'unsupported'

export type AdapterMissingField =
  | 'problemNumber'
  | 'title'
  | 'difficulty'
  | 'tags'
  | 'code'
  | 'language'
  | 'submissionResult'

export type AdapterWarningCode =
  'optional-field-missing' | 'unknown-submission-result'

export interface AdapterWarning {
  code: AdapterWarningCode
  stage: AdapterStage
  message: string
  fields?: AdapterMissingField[]
}

export interface AdapterFailure {
  code: AdapterFailureCode
  stage: AdapterStage
  message: string
  recoverable: boolean
  fallback: AdapterFallback
  missingFields?: AdapterMissingField[]
}

export type AdapterResult<T> =
  | {
      ok: true
      value: T
      warnings?: AdapterWarning[]
    }
  | {
      ok: false
      error: AdapterFailure
    }

export interface AdapterContext {
  url: URL
  document: Document
}

export interface CapturedProblem {
  platform: Platform
  platformProblemId?: string
  problemNumber: string
  title: string
  url: string
  difficulty?: string
  tags: string[]
}

export interface CapturedSolution {
  code: string
  language: ProgrammingLanguage
}

export interface CapturedSubmission {
  result: SubmissionResult
  language?: ProgrammingLanguage
}

export interface SubmissionObserver {
  disconnect(): void
}

export interface PlatformAdapter {
  readonly platform: Platform
  supports(url: URL): boolean
  captureProblem(context: AdapterContext): AdapterResult<CapturedProblem>
  captureSolution(context: AdapterContext): AdapterResult<CapturedSolution>
  observeSubmission(
    context: AdapterContext,
    onResult: (result: CapturedSubmission) => void,
  ): AdapterResult<SubmissionObserver>
}

export function adapterSuccess<T>(
  value: T,
  warnings: AdapterWarning[] = [],
): AdapterResult<T> {
  return warnings.length > 0
    ? { ok: true, value, warnings }
    : { ok: true, value }
}

export function adapterFailure(error: AdapterFailure): AdapterResult<never> {
  return { ok: false, error }
}
