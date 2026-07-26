import type { ProgrammingLanguage, SubmissionResult } from '../../common/types'
import {
  adapterFailure,
  adapterSuccess,
  type AdapterContext,
  type AdapterResult,
  type AdapterWarning,
  type CapturedProblem,
  type CapturedSolution,
  type CapturedSubmission,
  type PlatformAdapter,
  type SubmissionObserver,
} from '../common/PlatformAdapter'

const SWEA_HOSTS = new Set(['swexpertacademy.com', 'www.swexpertacademy.com'])
const SWEA_PROBLEM_PATHS = new Set([
  '/main/code/problem/problemDetail.do',
  '/main/talk/solvingClub/problemView.do',
])

const SELECTORS = {
  contractRoot: '[data-codearchive-swea]',
  problemNumber: '[data-codearchive-problem-number]',
  problemTitle: '[data-codearchive-problem-title]',
  problemDifficulty: '[data-codearchive-problem-difficulty]',
  problemTags: '[data-codearchive-problem-tags]',
  solutionCode: '[data-codearchive-solution-code]',
  solutionLanguage: '[data-codearchive-solution-language]',
  submissionResult: '[data-codearchive-submission-result]',
  submissionLanguage: '[data-codearchive-submission-language]',
} as const

function text(document: Document, selector: string): string | undefined {
  const value = document.querySelector(selector)?.textContent?.trim()
  return value ? value : undefined
}

function normalizedUrl(url: URL): string | undefined {
  if (url.protocol !== 'https:') return undefined
  const normalized = new URL(url)
  normalized.hash = ''
  return normalized.toString()
}

function domContractFailure(stage: 'problem' | 'solution' | 'submission') {
  return adapterFailure({
    code: 'dom-contract-changed',
    stage,
    message: 'The page does not expose the expected capture contract.',
    recoverable: true,
    fallback: 'manual-entry',
  })
}

function mapLanguage(value: string): ProgrammingLanguage | undefined {
  const normalized = value.trim().toLowerCase().replaceAll(/\s+/g, '')
  const languages: Readonly<Record<string, ProgrammingLanguage>> = {
    java: 'java',
    java8: 'java',
    java11: 'java',
    java17: 'java',
    python: 'python',
    python3: 'python',
    pypy3: 'python',
    c: 'c',
    c99: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    javascript: 'javascript',
    typescript: 'typescript',
    kotlin: 'kotlin',
    csharp: 'csharp',
    'c#': 'csharp',
    go: 'go',
    swift: 'swift',
    rust: 'rust',
  }
  return languages[normalized]
}

function mapSubmissionResult(value: string): SubmissionResult {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_]+/g, '-')
  const results: Readonly<Record<string, SubmissionResult>> = {
    accepted: 'accepted',
    ac: 'accepted',
    pass: 'accepted',
    'wrong-answer': 'wrong-answer',
    wa: 'wrong-answer',
    'compile-error': 'compile-error',
    'runtime-error': 'runtime-error',
    'time-limit-exceeded': 'time-limit-exceeded',
    'memory-limit-exceeded': 'memory-limit-exceeded',
    'presentation-error': 'presentation-error',
  }
  return results[normalized] ?? 'unknown'
}

function submissionFromDocument(
  document: Document,
): AdapterResult<CapturedSubmission> {
  const rawResult = text(document, SELECTORS.submissionResult)
  if (!rawResult) {
    return adapterFailure({
      code: 'missing-required-element',
      stage: 'submission',
      message: 'A submission result is not available.',
      recoverable: true,
      fallback: 'retry',
      missingFields: ['submissionResult'],
    })
  }

  const warnings: AdapterWarning[] = []
  const result = mapSubmissionResult(rawResult)
  if (result === 'unknown') {
    warnings.push({
      code: 'unknown-submission-result',
      stage: 'submission',
      message: 'The submission result is not recognized.',
      fields: ['submissionResult'],
    })
  }

  const rawLanguage = text(document, SELECTORS.submissionLanguage)
  let language: ProgrammingLanguage | undefined
  if (rawLanguage) {
    language = mapLanguage(rawLanguage)
    if (!language) {
      return adapterFailure({
        code: 'language-unresolved',
        stage: 'language',
        message: 'The submission language is not recognized.',
        recoverable: true,
        fallback: 'manual-entry',
        missingFields: ['language'],
      })
    }
  }

  return adapterSuccess({ result, language }, warnings)
}

export class SweaAdapter implements PlatformAdapter {
  readonly platform = 'swea' as const

  supports(url: URL): boolean {
    return (
      url.protocol === 'https:' &&
      SWEA_HOSTS.has(url.hostname.toLowerCase()) &&
      SWEA_PROBLEM_PATHS.has(url.pathname)
    )
  }

  captureProblem(context: AdapterContext): AdapterResult<CapturedProblem> {
    if (!this.supports(context.url)) {
      return adapterFailure({
        code: 'unsupported-url',
        stage: 'detect',
        message: 'This URL is not a supported SWEA problem page.',
        recoverable: false,
        fallback: 'manual-entry',
      })
    }
    if (!context.document.querySelector(SELECTORS.contractRoot)) {
      return domContractFailure('problem')
    }

    const problemNumber = text(context.document, SELECTORS.problemNumber)
    const title = text(context.document, SELECTORS.problemTitle)
    const missingFields = [
      ...(problemNumber ? [] : (['problemNumber'] as const)),
      ...(title ? [] : (['title'] as const)),
    ]
    if (!problemNumber || !title) {
      return adapterFailure({
        code: 'missing-required-element',
        stage: 'problem',
        message: 'Required problem metadata is not available.',
        recoverable: true,
        fallback: 'manual-entry',
        missingFields,
      })
    }

    const url = normalizedUrl(context.url)
    if (!url) {
      return adapterFailure({
        code: 'invalid-captured-data',
        stage: 'problem',
        message: 'The problem URL does not satisfy the capture contract.',
        recoverable: false,
        fallback: 'manual-entry',
      })
    }

    const difficulty = text(context.document, SELECTORS.problemDifficulty)
    const rawTags = text(context.document, SELECTORS.problemTags)
    const tags = rawTags
      ? [
          ...new Set(
            rawTags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ]
      : []
    const missingOptionalFields = [
      ...(difficulty ? [] : (['difficulty'] as const)),
      ...(rawTags ? [] : (['tags'] as const)),
    ]
    const warnings: AdapterWarning[] =
      missingOptionalFields.length > 0
        ? [
            {
              code: 'optional-field-missing',
              stage: 'problem',
              message: 'Optional problem metadata is not available.',
              fields: missingOptionalFields,
            },
          ]
        : []

    return adapterSuccess(
      {
        platform: this.platform,
        platformProblemId: problemNumber,
        problemNumber,
        title,
        url,
        difficulty,
        tags,
      },
      warnings,
    )
  }

  captureSolution(context: AdapterContext): AdapterResult<CapturedSolution> {
    if (!this.supports(context.url)) {
      return adapterFailure({
        code: 'unsupported-url',
        stage: 'detect',
        message: 'This URL is not a supported SWEA problem page.',
        recoverable: false,
        fallback: 'manual-entry',
      })
    }
    if (!context.document.querySelector(SELECTORS.contractRoot)) {
      return domContractFailure('solution')
    }

    const code = text(context.document, SELECTORS.solutionCode)
    if (!code) {
      return adapterFailure({
        code: 'code-unavailable',
        stage: 'solution',
        message: 'Solution code is not available for capture.',
        recoverable: true,
        fallback: 'manual-entry',
        missingFields: ['code'],
      })
    }

    const rawLanguage = text(context.document, SELECTORS.solutionLanguage)
    const language = rawLanguage ? mapLanguage(rawLanguage) : undefined
    if (!language) {
      return adapterFailure({
        code: 'language-unresolved',
        stage: 'language',
        message: 'The solution language is not recognized.',
        recoverable: true,
        fallback: 'manual-entry',
        missingFields: ['language'],
      })
    }

    return adapterSuccess({ code, language })
  }

  observeSubmission(
    context: AdapterContext,
    onResult: (result: CapturedSubmission) => void,
  ): AdapterResult<SubmissionObserver> {
    if (!this.supports(context.url)) {
      return adapterFailure({
        code: 'unsupported-url',
        stage: 'detect',
        message: 'This URL is not a supported SWEA problem page.',
        recoverable: false,
        fallback: 'manual-entry',
      })
    }
    if (!context.document.querySelector(SELECTORS.contractRoot)) {
      return domContractFailure('submission')
    }

    const resultElement = context.document.querySelector(
      SELECTORS.submissionResult,
    )
    const MutationObserverConstructor =
      context.document.defaultView?.MutationObserver
    if (!resultElement || !MutationObserverConstructor) {
      return adapterFailure({
        code: 'submission-observer-unavailable',
        stage: 'submission',
        message: 'Submission result observation is not available.',
        recoverable: true,
        fallback: 'manual-entry',
        missingFields: resultElement ? undefined : ['submissionResult'],
      })
    }

    const emit = () => {
      const captured = submissionFromDocument(context.document)
      if (captured.ok) onResult(captured.value)
    }
    const observer = new MutationObserverConstructor(emit)
    observer.observe(resultElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
    emit()

    let disconnected = false
    return adapterSuccess({
      disconnect() {
        if (disconnected) return
        disconnected = true
        observer.disconnect()
      },
    })
  }
}

export const sweaAdapter = new SweaAdapter()
