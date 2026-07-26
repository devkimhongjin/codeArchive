import {
  AI_CONTRIBUTION_RATES,
  AI_USAGE_LEVELS,
  AI_USAGE_PURPOSES,
  EXPLANATION_ABILITIES,
  PLATFORMS,
  PROGRAMMING_LANGUAGES,
  RECORD_SOURCES,
  SOLVABLE_WITHOUT_AI_VALUES,
  SUBMISSION_RESULTS,
  UNDERSTANDING_LEVELS,
  type AIUsageRecord,
  type CoreDataAggregate,
  type DuplicateCandidateKey,
  type DuplicateComparison,
  type ParseResult,
  type Problem,
  type SolutionSession,
  type Submission,
  type ValidationIssue,
  type ValidationIssueCode,
} from '../types'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

const PROBLEM_FIELDS = [
  'schemaVersion',
  'id',
  'platform',
  'platformProblemId',
  'problemNumber',
  'title',
  'url',
  'difficulty',
  'tags',
  'source',
  'createdAt',
  'updatedAt',
] as const

const SOLUTION_SESSION_FIELDS = [
  'schemaVersion',
  'id',
  'problemId',
  'language',
  'result',
  'code',
  'solvedAt',
  'summary',
  'approach',
  'timeComplexity',
  'spaceComplexity',
  'mistakes',
  'reviewRequired',
  'reviewDate',
  'source',
  'githubFilePath',
  'codeHash',
  'createdAt',
  'updatedAt',
] as const

const SUBMISSION_FIELDS = [
  'schemaVersion',
  'id',
  'solutionSessionId',
  'platformSubmissionId',
  'result',
  'language',
  'code',
  'executionTimeMs',
  'memoryKiB',
  'submittedAt',
  'source',
  'createdAt',
] as const

const AI_USAGE_FIELDS = [
  'schemaVersion',
  'id',
  'solutionSessionId',
  'level',
  'purposes',
  'provider',
  'model',
  'promptSummary',
  'referencedContent',
  'contributionRate',
  'copiedDirectly',
  'modifiedAfterUse',
  'understandingLevel',
  'solvableWithoutAI',
  'explanationAbility',
  'reviewRequired',
  'recordedAt',
  'createdAt',
  'updatedAt',
] as const

type UnknownRecord = Record<string, unknown>

function issue(
  path: string,
  code: ValidationIssueCode,
  message: string,
): ValidationIssue {
  return { path, code, message }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function validateUnknownFields(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push(
        issue(`${path}.${key}`, 'unknown_field', `Unknown field: ${key}`),
      )
    }
  }
}

function requiredString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  preserveWhitespace = false,
): string {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'missing_required', 'Expected a string'))
    return ''
  }

  if (value.trim().length === 0) {
    issues.push(issue(path, 'missing_required', 'String must not be empty'))
  }

  return preserveWhitespace ? value : value.trim()
}

function optionalString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  preserveWhitespace = false,
): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, path, issues, preserveWhitespace)
}

function requiredBoolean(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean {
  if (typeof value !== 'boolean') {
    issues.push(issue(path, 'invalid_type', 'Expected a boolean'))
    return false
  }
  return value
}

function optionalBoolean(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  if (value === undefined) return undefined
  return requiredBoolean(value, path, issues)
}

function validateSchemaVersion(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): 1 {
  if (value !== 1) {
    issues.push(
      issue(
        path,
        'unsupported_schema_version',
        'Only schemaVersion 1 is supported',
      ),
    )
  }
  return 1
}

function validateEntityId(
  value: unknown,
  namespace: string,
  path: string,
  issues: ValidationIssue[],
): string {
  const text = requiredString(value, path, issues)
  const prefix = `${namespace}:`
  if (
    !text.startsWith(prefix) ||
    !UUID_V4_PATTERN.test(text.slice(prefix.length))
  ) {
    issues.push(
      issue(path, 'invalid_format', `Expected ${namespace}:<uuid-v4>`),
    )
  }
  return text
}

export function isUtcTimestamp(value: string): boolean {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

function timestamp(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string {
  const text = requiredString(value, path, issues)
  if (!isUtcTimestamp(text)) {
    issues.push(
      issue(
        path,
        'invalid_format',
        'Expected UTC RFC 3339 timestamp with milliseconds',
      ),
    )
  }
  return text
}

function optionalTimestamp(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (value === undefined) return undefined
  return timestamp(value, path, issues)
}

function optionalCalendarDate(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (value === undefined) return undefined
  const text = requiredString(value, path, issues)
  if (!isCalendarDate(text)) {
    issues.push(issue(path, 'invalid_format', 'Expected a valid YYYY-MM-DD'))
  }
  return text
}

function stringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  normalize = false,
): string[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'invalid_type', 'Expected an array'))
    return []
  }

  const result: string[] = []
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      issues.push(
        issue(`${path}[${index}]`, 'invalid_type', 'Expected a string'),
      )
      return
    }
    const normalized = normalize ? item.trim() : item
    if (normalized.length === 0) {
      if (!normalize) {
        issues.push(
          issue(
            `${path}[${index}]`,
            'invalid_format',
            'Value must not be empty',
          ),
        )
      }
      return
    }
    if (!result.includes(normalized)) result.push(normalized)
  })
  return result
}

function nonNegativeInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issues.push(issue(path, 'invalid_type', 'Expected a non-negative integer'))
    return undefined
  }
  return value
}

function validateTimeOrder(
  earlier: string,
  later: string,
  laterPath: string,
  issues: ValidationIssue[],
): void {
  if (isUtcTimestamp(earlier) && isUtcTimestamp(later) && later < earlier) {
    issues.push(
      issue(laterPath, 'invalid_relation', 'Timestamp precedes createdAt'),
    )
  }
}

export function normalizeProblemUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    url.searchParams.sort()
    return url.toString()
  } catch {
    return undefined
  }
}

export function normalizeTitle(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function normalizeGitHubFilePath(value: string): string {
  return value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+/g, '/')
}

export function parseProblem(
  value: unknown,
  path = 'problem',
): ParseResult<Problem> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [issue(path, 'invalid_type', 'Expected an object')],
    }
  }
  validateUnknownFields(value, PROBLEM_FIELDS, path, issues)

  const schemaVersion = validateSchemaVersion(
    value.schemaVersion,
    `${path}.schemaVersion`,
    issues,
  )
  const id = validateEntityId(value.id, 'problem', `${path}.id`, issues)
  const platform = isOneOf(value.platform, PLATFORMS)
    ? value.platform
    : (issues.push(
        issue(`${path}.platform`, 'invalid_enum', 'Unsupported platform'),
      ),
      'swea')
  const platformProblemId = optionalString(
    value.platformProblemId,
    `${path}.platformProblemId`,
    issues,
  )
  const problemNumber = optionalString(
    value.problemNumber,
    `${path}.problemNumber`,
    issues,
  )
  const title = optionalString(value.title, `${path}.title`, issues)
  const difficulty = optionalString(
    value.difficulty,
    `${path}.difficulty`,
    issues,
  )
  const source = isOneOf(value.source, RECORD_SOURCES)
    ? value.source
    : (issues.push(
        issue(`${path}.source`, 'invalid_enum', 'Unsupported source'),
      ),
      'manual')
  const tags = stringArray(value.tags, `${path}.tags`, issues, true)
  const createdAt = timestamp(value.createdAt, `${path}.createdAt`, issues)
  const updatedAt = timestamp(value.updatedAt, `${path}.updatedAt`, issues)
  validateTimeOrder(createdAt, updatedAt, `${path}.updatedAt`, issues)

  if (!platformProblemId && !problemNumber && !title) {
    issues.push(
      issue(
        path,
        'missing_required',
        'At least one problem identifier or title is required',
      ),
    )
  }
  if (source === 'auto-captured' && (!problemNumber || !title)) {
    issues.push(
      issue(
        path,
        'missing_required',
        'Auto-captured problems require problemNumber and title',
      ),
    )
  }

  let url: string | undefined
  if (value.url !== undefined) {
    const rawUrl = requiredString(value.url, `${path}.url`, issues)
    url = normalizeProblemUrl(rawUrl)
    if (!url) {
      issues.push(
        issue(
          `${path}.url`,
          'invalid_format',
          'Expected an absolute HTTPS URL',
        ),
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion,
      id: id as Problem['id'],
      platform,
      platformProblemId,
      problemNumber,
      title,
      url,
      difficulty,
      tags,
      source,
      createdAt,
      updatedAt,
    },
  }
}

export function parseSolutionSession(
  value: unknown,
  path = 'solutionSession',
): ParseResult<SolutionSession> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [issue(path, 'invalid_type', 'Expected an object')],
    }
  }
  validateUnknownFields(value, SOLUTION_SESSION_FIELDS, path, issues)

  const schemaVersion = validateSchemaVersion(
    value.schemaVersion,
    `${path}.schemaVersion`,
    issues,
  )
  const id = validateEntityId(
    value.id,
    'solution-session',
    `${path}.id`,
    issues,
  )
  const problemId = validateEntityId(
    value.problemId,
    'problem',
    `${path}.problemId`,
    issues,
  )
  const language = isOneOf(value.language, PROGRAMMING_LANGUAGES)
    ? value.language
    : (issues.push(
        issue(`${path}.language`, 'invalid_enum', 'Unsupported language'),
      ),
      'java')
  const result = isOneOf(value.result, SUBMISSION_RESULTS)
    ? value.result
    : (issues.push(
        issue(`${path}.result`, 'invalid_enum', 'Unsupported result'),
      ),
      'unknown')
  const source = isOneOf(value.source, RECORD_SOURCES)
    ? value.source
    : (issues.push(
        issue(`${path}.source`, 'invalid_enum', 'Unsupported source'),
      ),
      'manual')
  const reviewRequired = requiredBoolean(
    value.reviewRequired,
    `${path}.reviewRequired`,
    issues,
  )
  const reviewDate = optionalCalendarDate(
    value.reviewDate,
    `${path}.reviewDate`,
    issues,
  )
  if (reviewDate && !reviewRequired) {
    issues.push(
      issue(
        `${path}.reviewDate`,
        'invalid_relation',
        'reviewDate requires reviewRequired=true',
      ),
    )
  }
  const codeHash = optionalString(value.codeHash, `${path}.codeHash`, issues)
  if (codeHash && !SHA256_PATTERN.test(codeHash)) {
    issues.push(
      issue(`${path}.codeHash`, 'invalid_format', 'Expected SHA-256 hex'),
    )
  }
  const createdAt = timestamp(value.createdAt, `${path}.createdAt`, issues)
  const updatedAt = timestamp(value.updatedAt, `${path}.updatedAt`, issues)
  validateTimeOrder(createdAt, updatedAt, `${path}.updatedAt`, issues)
  const code = optionalString(value.code, `${path}.code`, issues, true)
  const solvedAt = optionalTimestamp(value.solvedAt, `${path}.solvedAt`, issues)
  const summary = optionalString(value.summary, `${path}.summary`, issues)
  const approach = optionalString(value.approach, `${path}.approach`, issues)
  const timeComplexity = optionalString(
    value.timeComplexity,
    `${path}.timeComplexity`,
    issues,
  )
  const spaceComplexity = optionalString(
    value.spaceComplexity,
    `${path}.spaceComplexity`,
    issues,
  )
  const mistakes = stringArray(value.mistakes, `${path}.mistakes`, issues)
  const rawGithubFilePath = optionalString(
    value.githubFilePath,
    `${path}.githubFilePath`,
    issues,
  )
  const githubFilePath = rawGithubFilePath
    ? normalizeGitHubFilePath(rawGithubFilePath)
    : undefined

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion,
      id: id as SolutionSession['id'],
      problemId: problemId as SolutionSession['problemId'],
      language,
      result,
      code,
      solvedAt,
      summary,
      approach,
      timeComplexity,
      spaceComplexity,
      mistakes,
      reviewRequired,
      reviewDate,
      source,
      githubFilePath,
      codeHash,
      createdAt,
      updatedAt,
    },
  }
}

export function parseSubmission(
  value: unknown,
  path = 'submission',
): ParseResult<Submission> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [issue(path, 'invalid_type', 'Expected an object')],
    }
  }
  validateUnknownFields(value, SUBMISSION_FIELDS, path, issues)

  const schemaVersion = validateSchemaVersion(
    value.schemaVersion,
    `${path}.schemaVersion`,
    issues,
  )
  const id = validateEntityId(value.id, 'submission', `${path}.id`, issues)
  const solutionSessionId = validateEntityId(
    value.solutionSessionId,
    'solution-session',
    `${path}.solutionSessionId`,
    issues,
  )
  const result = isOneOf(value.result, SUBMISSION_RESULTS)
    ? value.result
    : (issues.push(
        issue(`${path}.result`, 'invalid_enum', 'Unsupported result'),
      ),
      'unknown')
  const language = isOneOf(value.language, PROGRAMMING_LANGUAGES)
    ? value.language
    : (issues.push(
        issue(`${path}.language`, 'invalid_enum', 'Unsupported language'),
      ),
      'java')
  const source = isOneOf(value.source, RECORD_SOURCES)
    ? value.source
    : (issues.push(
        issue(`${path}.source`, 'invalid_enum', 'Unsupported source'),
      ),
      'manual')
  const platformSubmissionId = optionalString(
    value.platformSubmissionId,
    `${path}.platformSubmissionId`,
    issues,
  )
  const code = optionalString(value.code, `${path}.code`, issues, true)
  const executionTimeMs = nonNegativeInteger(
    value.executionTimeMs,
    `${path}.executionTimeMs`,
    issues,
  )
  const memoryKiB = nonNegativeInteger(
    value.memoryKiB,
    `${path}.memoryKiB`,
    issues,
  )
  const submittedAt = timestamp(
    value.submittedAt,
    `${path}.submittedAt`,
    issues,
  )
  const createdAt = timestamp(value.createdAt, `${path}.createdAt`, issues)

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion,
      id: id as Submission['id'],
      solutionSessionId: solutionSessionId as Submission['solutionSessionId'],
      platformSubmissionId,
      result,
      language,
      code,
      executionTimeMs,
      memoryKiB,
      submittedAt,
      source,
      createdAt,
    },
  }
}

export function parseAIUsageRecord(
  value: unknown,
  path = 'aiUsage',
): ParseResult<AIUsageRecord> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [issue(path, 'invalid_type', 'Expected an object')],
    }
  }
  validateUnknownFields(value, AI_USAGE_FIELDS, path, issues)

  const schemaVersion = validateSchemaVersion(
    value.schemaVersion,
    `${path}.schemaVersion`,
    issues,
  )
  const id = validateEntityId(value.id, 'ai-usage', `${path}.id`, issues)
  const solutionSessionId = validateEntityId(
    value.solutionSessionId,
    'solution-session',
    `${path}.solutionSessionId`,
    issues,
  )
  const level = isOneOf(value.level, AI_USAGE_LEVELS)
    ? value.level
    : (issues.push(
        issue(`${path}.level`, 'invalid_enum', 'Unsupported AI level'),
      ),
      'unrecorded')
  const purposes = Array.isArray(value.purposes)
    ? value.purposes.flatMap((purpose, index) => {
        if (isOneOf(purpose, AI_USAGE_PURPOSES)) return [purpose]
        issues.push(
          issue(
            `${path}.purposes[${index}]`,
            'invalid_enum',
            'Unsupported AI purpose',
          ),
        )
        return []
      })
    : (issues.push(
        issue(`${path}.purposes`, 'invalid_type', 'Expected an array'),
      ),
      [])
  if ((level === 'none' || level === 'unrecorded') && purposes.length > 0) {
    issues.push(
      issue(
        `${path}.purposes`,
        'invalid_relation',
        `${level} requires an empty purposes array`,
      ),
    )
  }
  const contributionRate =
    value.contributionRate === undefined
      ? undefined
      : isOneOf(value.contributionRate, AI_CONTRIBUTION_RATES)
        ? value.contributionRate
        : (issues.push(
            issue(
              `${path}.contributionRate`,
              'invalid_enum',
              'Unsupported contribution rate',
            ),
          ),
          undefined)
  if (level === 'none' && contributionRate && contributionRate !== '0') {
    issues.push(
      issue(
        `${path}.contributionRate`,
        'invalid_relation',
        'AI level none only permits contribution rate 0',
      ),
    )
  }
  const createdAt = timestamp(value.createdAt, `${path}.createdAt`, issues)
  const recordedAt = timestamp(value.recordedAt, `${path}.recordedAt`, issues)
  const updatedAt = timestamp(value.updatedAt, `${path}.updatedAt`, issues)
  validateTimeOrder(createdAt, recordedAt, `${path}.recordedAt`, issues)
  validateTimeOrder(createdAt, updatedAt, `${path}.updatedAt`, issues)
  const provider = optionalString(value.provider, `${path}.provider`, issues)
  const model = optionalString(value.model, `${path}.model`, issues)
  const promptSummary = optionalString(
    value.promptSummary,
    `${path}.promptSummary`,
    issues,
  )
  const referencedContent = optionalString(
    value.referencedContent,
    `${path}.referencedContent`,
    issues,
  )
  const copiedDirectly = optionalBoolean(
    value.copiedDirectly,
    `${path}.copiedDirectly`,
    issues,
  )
  const modifiedAfterUse = optionalBoolean(
    value.modifiedAfterUse,
    `${path}.modifiedAfterUse`,
    issues,
  )
  const understandingLevel =
    value.understandingLevel === undefined
      ? undefined
      : isOneOf(value.understandingLevel, UNDERSTANDING_LEVELS)
        ? value.understandingLevel
        : (issues.push(
            issue(
              `${path}.understandingLevel`,
              'invalid_enum',
              'Unsupported understanding level',
            ),
          ),
          undefined)
  const solvableWithoutAI =
    value.solvableWithoutAI === undefined
      ? undefined
      : isOneOf(value.solvableWithoutAI, SOLVABLE_WITHOUT_AI_VALUES)
        ? value.solvableWithoutAI
        : (issues.push(
            issue(
              `${path}.solvableWithoutAI`,
              'invalid_enum',
              'Unsupported solvability value',
            ),
          ),
          undefined)
  const explanationAbility =
    value.explanationAbility === undefined
      ? undefined
      : isOneOf(value.explanationAbility, EXPLANATION_ABILITIES)
        ? value.explanationAbility
        : (issues.push(
            issue(
              `${path}.explanationAbility`,
              'invalid_enum',
              'Unsupported explanation ability',
            ),
          ),
          undefined)
  const reviewRequired = requiredBoolean(
    value.reviewRequired,
    `${path}.reviewRequired`,
    issues,
  )

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion,
      id: id as AIUsageRecord['id'],
      solutionSessionId:
        solutionSessionId as AIUsageRecord['solutionSessionId'],
      level,
      purposes,
      provider,
      model,
      promptSummary,
      referencedContent,
      contributionRate,
      copiedDirectly,
      modifiedAfterUse,
      understandingLevel,
      solvableWithoutAI,
      explanationAbility,
      reviewRequired,
      recordedAt,
      createdAt,
      updatedAt,
    },
  }
}

function parseArray<T>(
  value: unknown,
  path: string,
  parser: (item: unknown, itemPath: string) => ParseResult<T>,
  issues: ValidationIssue[],
): T[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'invalid_type', 'Expected an array'))
    return []
  }
  const parsed: T[] = []
  value.forEach((item, index) => {
    const result = parser(item, `${path}[${index}]`)
    if (result.ok) parsed.push(result.value)
    else issues.push(...result.issues)
  })
  return parsed
}

export function parseCoreDataAggregate(
  value: unknown,
): ParseResult<CoreDataAggregate> {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [issue('aggregate', 'invalid_type', 'Expected an object')],
    }
  }
  const issues: ValidationIssue[] = []
  validateUnknownFields(
    value,
    ['problems', 'solutionSessions', 'submissions', 'aiUsageRecords'],
    'aggregate',
    issues,
  )
  const problems = parseArray(value.problems, 'problems', parseProblem, issues)
  const solutionSessions = parseArray(
    value.solutionSessions,
    'solutionSessions',
    parseSolutionSession,
    issues,
  )
  const submissions = parseArray(
    value.submissions,
    'submissions',
    parseSubmission,
    issues,
  )
  const aiUsageRecords = parseArray(
    value.aiUsageRecords,
    'aiUsageRecords',
    parseAIUsageRecord,
    issues,
  )

  const problemIds = new Set(problems.map((problem) => problem.id))
  const sessionsById = new Map(
    solutionSessions.map((session) => [session.id, session]),
  )
  solutionSessions.forEach((session, index) => {
    if (!problemIds.has(session.problemId)) {
      issues.push(
        issue(
          `solutionSessions[${index}].problemId`,
          'invalid_relation',
          'Referenced Problem does not exist',
        ),
      )
    }
  })
  submissions.forEach((submission, index) => {
    const session = sessionsById.get(submission.solutionSessionId)
    if (!session) {
      issues.push(
        issue(
          `submissions[${index}].solutionSessionId`,
          'invalid_relation',
          'Referenced SolutionSession does not exist',
        ),
      )
    } else if (session.language !== submission.language) {
      issues.push(
        issue(
          `submissions[${index}].language`,
          'invalid_relation',
          'Submission language differs from its SolutionSession',
        ),
      )
    }
  })

  const aiCountBySession = new Map<string, number>()
  aiUsageRecords.forEach((record, index) => {
    if (!sessionsById.has(record.solutionSessionId)) {
      issues.push(
        issue(
          `aiUsageRecords[${index}].solutionSessionId`,
          'invalid_relation',
          'Referenced SolutionSession does not exist',
        ),
      )
    }
    aiCountBySession.set(
      record.solutionSessionId,
      (aiCountBySession.get(record.solutionSessionId) ?? 0) + 1,
    )
  })
  solutionSessions.forEach((session, index) => {
    if ((aiCountBySession.get(session.id) ?? 0) !== 1) {
      issues.push(
        issue(
          `solutionSessions[${index}].id`,
          'invalid_relation',
          'Each SolutionSession requires exactly one AIUsageRecord',
        ),
      )
    }
  })

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: { problems, solutionSessions, submissions, aiUsageRecords },
  }
}

function problemKeys(problem: Problem): DuplicateCandidateKey[] {
  const keys: DuplicateCandidateKey[] = []
  if (problem.platformProblemId) {
    keys.push({
      field: 'platformProblemId',
      strength: 'strong',
      value: `${problem.platform}:${problem.platformProblemId}`,
    })
  }
  if (problem.problemNumber) {
    keys.push({
      field: 'problemNumber',
      strength: 'strong',
      value: `${problem.platform}:${problem.problemNumber}`,
    })
  }
  if (problem.url) {
    keys.push({
      field: 'url',
      strength: 'strong',
      value: `${problem.platform}:${normalizeProblemUrl(problem.url) ?? problem.url}`,
    })
  }
  if (problem.title) {
    keys.push({
      field: 'title',
      strength: 'weak',
      value: `${problem.platform}:${normalizeTitle(problem.title)}`,
    })
  }
  return keys
}

export function compareProblems(
  left: Problem,
  right: Problem,
): DuplicateComparison {
  if (left.platform !== right.platform) {
    return { kind: 'none', matchingKeys: [], autoMerge: false }
  }
  const leftKeys = problemKeys(left)
  const rightKeys = problemKeys(right)
  const matchingKeys = leftKeys.filter((leftKey) =>
    rightKeys.some(
      (rightKey) =>
        rightKey.field === leftKey.field && rightKey.value === leftKey.value,
    ),
  )
  const strongLeft = leftKeys.filter((key) => key.strength === 'strong')
  const conflictingFields = strongLeft
    .filter((leftKey) =>
      rightKeys.some(
        (rightKey) =>
          rightKey.field === leftKey.field &&
          rightKey.strength === 'strong' &&
          rightKey.value !== leftKey.value,
      ),
    )
    .map((key) => key.field)

  if (
    matchingKeys.some((key) => key.strength === 'strong') &&
    conflictingFields.length > 0
  ) {
    return {
      kind: 'duplicate_conflict',
      matchingKeys,
      conflictingFields,
      autoMerge: false,
    }
  }
  if (matchingKeys.length === 0) {
    return { kind: 'none', matchingKeys: [], autoMerge: false }
  }
  return {
    kind: 'candidate',
    strength: matchingKeys.some((key) => key.strength === 'strong')
      ? 'strong'
      : 'weak',
    matchingKeys,
    autoMerge: false,
  }
}

export function compareSolutionSessions(
  left: SolutionSession,
  right: SolutionSession,
): DuplicateComparison {
  const matchingKeys: DuplicateCandidateKey[] = []
  if (
    left.githubFilePath &&
    right.githubFilePath &&
    normalizeGitHubFilePath(left.githubFilePath) ===
      normalizeGitHubFilePath(right.githubFilePath)
  ) {
    matchingKeys.push({
      field: 'githubFilePath',
      strength: 'weak',
      value: normalizeGitHubFilePath(left.githubFilePath),
    })
  }
  if (left.codeHash && right.codeHash && left.codeHash === right.codeHash) {
    matchingKeys.push({
      field: 'codeHash',
      strength: 'weak',
      value: left.codeHash,
    })
  }
  return matchingKeys.length === 0
    ? { kind: 'none', matchingKeys: [], autoMerge: false }
    : {
        kind: 'candidate',
        strength: 'weak',
        matchingKeys,
        autoMerge: false,
      }
}
