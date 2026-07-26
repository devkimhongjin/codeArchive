import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  createEntityId,
  type AIUsageRecord,
  type CoreDataAggregate,
  type ParseResult,
  type Problem,
  type SolutionSession,
  type Submission,
} from '../../src/common/types'
import {
  compareProblems,
  compareSolutionSessions,
  isCalendarDate,
  isUtcTimestamp,
  normalizeGitHubFilePath,
  normalizeProblemUrl,
  normalizeTitle,
  parseAIUsageRecord,
  parseCoreDataAggregate,
  parseProblem,
  parseSubmission,
} from '../../src/common/validators'

interface SolutionFixture extends SolutionSession {
  aiUsage: AIUsageRecord
}

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function aggregateFixture(): CoreDataAggregate {
  const problems = fixture<Problem[]>('problems.json')
  const solutionFixtures = fixture<SolutionFixture[]>('solutions.json')
  const submissions = fixture<Submission[]>('submissions.json')
  return {
    problems,
    solutionSessions: solutionFixtures.map(({ aiUsage, ...session }) => {
      if (!aiUsage) throw new Error('Solution fixture requires aiUsage')
      return session
    }),
    submissions,
    aiUsageRecords: solutionFixtures.map(({ aiUsage }) => aiUsage),
  }
}

function issuesOf<T>(result: ParseResult<T>) {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected validation failure')
  return result.issues
}

describe('core data contract', () => {
  it('round-trips the aggregate fixtures without changing semantics', () => {
    const input = aggregateFixture()
    const result = parseCoreDataAggregate(
      JSON.parse(JSON.stringify(input)) as unknown,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(input)
    }
  })

  it('creates namespaced entity IDs', () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000'

    expect(createEntityId('problem', () => uuid)).toBe(`problem:${uuid}`)
    expect(createEntityId('solutionSession', () => uuid)).toBe(
      `solution-session:${uuid}`,
    )
    expect(createEntityId('submission', () => uuid)).toBe(`submission:${uuid}`)
    expect(createEntityId('aiUsageRecord', () => uuid)).toBe(`ai-usage:${uuid}`)

    const ids = new Set(
      Array.from({ length: 100 }, (_, index) =>
        createEntityId(
          'problem',
          () =>
            `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        ),
      ),
    )
    expect(ids.size).toBe(100)
  })

  it('rejects invalid namespaces, UUID versions and schema versions', () => {
    const problem = structuredClone(aggregateFixture().problems[0])
    problem.id = 'problem:11111111-1111-1111-8111-111111111111' as Problem['id']
    problem.schemaVersion = 2 as 1

    const issues = issuesOf(parseProblem(problem))
    expect(issues.map(({ code }) => code)).toContain('invalid_format')
    expect(issues.map(({ code }) => code)).toContain(
      'unsupported_schema_version',
    )

    for (const schemaVersion of [undefined, 0, '1']) {
      const input = {
        ...aggregateFixture().problems[0],
        schemaVersion,
      }
      expect(
        issuesOf(parseProblem(input)).some(
          ({ path }) => path === 'problem.schemaVersion',
        ),
      ).toBe(true)
    }
  })

  it('rejects a valid ID format when a reference uses the wrong namespace', () => {
    const aggregate = aggregateFixture()
    aggregate.solutionSessions[0].problemId =
      'solution-session:33333333-3333-4333-8333-333333333333' as never

    const issues = issuesOf(parseCoreDataAggregate(aggregate))
    expect(
      issues.some(
        ({ code, path }) =>
          code === 'invalid_format' && path === 'solutionSessions[0].problemId',
      ),
    ).toBe(true)
  })

  it('validates strict UTC timestamps and calendar dates', () => {
    expect(isUtcTimestamp('2026-07-25T12:34:56.789Z')).toBe(true)
    expect(isUtcTimestamp('2026-07-25T12:34:56Z')).toBe(false)
    expect(isUtcTimestamp('2026-07-25T21:34:56.789+09:00')).toBe(false)
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2027-02-29')).toBe(false)

    const record = structuredClone(aggregateFixture().aiUsageRecords[0])
    record.recordedAt = '2026-07-25T09:59:59.999Z'
    expect(
      issuesOf(parseAIUsageRecord(record)).some(
        ({ path }) => path === 'aiUsage.recordedAt',
      ),
    ).toBe(true)

    const reversed = {
      ...aggregateFixture().problems[0],
      createdAt: '2026-07-25T10:00:00.000Z',
      updatedAt: '2026-07-25T09:59:59.999Z',
    }
    expect(
      issuesOf(parseProblem(reversed)).some(
        ({ code, path }) =>
          code === 'invalid_relation' && path === 'problem.updatedAt',
      ),
    ).toBe(true)
  })

  it('applies conditional Problem requirements and reports all errors', () => {
    const input = {
      schemaVersion: 2,
      id: 'wrong:11111111-1111-4111-8111-111111111111',
      platform: 'unknown',
      tags: [' ', 'graph', 'graph'],
      source: 'auto-captured',
      createdAt: '2026-07-25T10:00:00Z',
      updatedAt: '2026-07-24T10:00:00.000Z',
      unexpected: true,
    }
    Object.freeze(input)

    const issues = issuesOf(parseProblem(input))
    expect(issues.length).toBeGreaterThanOrEqual(6)
    expect(issues.some(({ path }) => path === 'problem.unexpected')).toBe(true)

    const numberOnly = {
      ...aggregateFixture().problems[1],
      title: undefined,
      problemNumber: '42842',
    }
    expect(parseProblem(numberOnly).ok).toBe(true)

    const titleOnly = aggregateFixture().problems[1]
    expect(parseProblem(titleOnly).ok).toBe(true)

    const autoCaptured = aggregateFixture().problems[0]
    for (const input of [
      { ...autoCaptured, problemNumber: undefined },
      { ...autoCaptured, title: undefined },
    ]) {
      expect(
        issuesOf(parseProblem(input)).some(
          ({ code }) => code === 'missing_required',
        ),
      ).toBe(true)
    }

    for (const url of [
      'http://example.com/1206',
      '/problem/1206',
      'not a url',
    ]) {
      expect(
        issuesOf(parseProblem({ ...titleOnly, url })).some(
          ({ path }) => path === 'problem.url',
        ),
      ).toBe(true)
    }

    const normalized = parseProblem({
      ...titleOnly,
      tags: [' graph ', '', 'graph', 'Graph'],
      url: 'https://example.com/1206/#answer',
    })
    expect(normalized.ok).toBe(true)
    if (normalized.ok) {
      expect(normalized.value.tags).toEqual(['graph', 'Graph'])
      expect(normalized.value.url).toBe('https://example.com/1206')
    }
  })

  it('keeps none and unrecorded distinct and rejects purposes for both', () => {
    const records = aggregateFixture().aiUsageRecords
    const none = records.find(({ level }) => level === 'none')
    const unrecorded = records.find(({ level }) => level === 'unrecorded')

    expect(none?.level).toBe('none')
    expect(unrecorded?.level).toBe('unrecorded')

    const invalid = structuredClone(none)
    if (!invalid) throw new Error('Missing none fixture')
    invalid.purposes = ['counterexample']
    const issues = issuesOf(parseAIUsageRecord(invalid))
    expect(issues.some(({ path }) => path === 'aiUsage.purposes')).toBe(true)

    const nonZero = { ...invalid, purposes: [], contributionRate: '26-50' }
    expect(
      issuesOf(parseAIUsageRecord(nonZero)).some(
        ({ path }) => path === 'aiUsage.contributionRate',
      ),
    ).toBe(true)

    expect(aggregateFixture().aiUsageRecords.map(({ level }) => level)).toEqual(
      ['partial-hint', 'none', 'unrecorded'],
    )

    const nestedPurpose = {
      ...records[0],
      purposes: ['counterexample', 'not-a-purpose'],
    }
    expect(
      issuesOf(parseAIUsageRecord(nestedPurpose)).some(
        ({ code, path }) =>
          code === 'invalid_enum' && path === 'aiUsage.purposes[1]',
      ),
    ).toBe(true)
  })

  it('rejects invalid units and preserves source code whitespace', () => {
    const submission = structuredClone(aggregateFixture().submissions[0])
    submission.executionTimeMs = -1
    submission.memoryKiB = 1.5
    const invalidIssues = issuesOf(parseSubmission(submission))
    expect(
      invalidIssues.filter(({ code }) => code === 'invalid_type'),
    ).toHaveLength(2)

    expect(
      issuesOf(
        parseSubmission({
          ...aggregateFixture().submissions[0],
          executionTimeMs: '120',
          memoryKiB: '64000',
        }),
      ).filter(({ code }) => code === 'invalid_type'),
    ).toHaveLength(2)

    const valid = structuredClone(aggregateFixture().submissions[0])
    valid.code = '  line one\nline two\n'
    const result = parseSubmission(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.code).toBe(valid.code)
  })

  it('rejects orphan relations, language mismatches and missing AI records', () => {
    const aggregate = aggregateFixture()
    aggregate.submissions[0].language = 'python'
    aggregate.aiUsageRecords = aggregate.aiUsageRecords.slice(1)
    aggregate.solutionSessions[2].problemId =
      'problem:ffffffff-ffff-4fff-8fff-ffffffffffff'

    const issues = issuesOf(parseCoreDataAggregate(aggregate))
    expect(issues.some(({ path }) => path.endsWith('.language'))).toBe(true)
    expect(
      issues.some(({ message }) =>
        message.includes('exactly one AIUsageRecord'),
      ),
    ).toBe(true)
    expect(
      issues.some(({ message }) => message.includes('Problem does not exist')),
    ).toBe(true)

    const duplicateAI = aggregateFixture()
    duplicateAI.aiUsageRecords.push({
      ...duplicateAI.aiUsageRecords[0],
      id: 'ai-usage:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    })
    expect(
      issuesOf(parseCoreDataAggregate(duplicateAI)).some(({ message }) =>
        message.includes('exactly one AIUsageRecord'),
      ),
    ).toBe(true)

    const orphanSubmission = aggregateFixture()
    orphanSubmission.submissions[0].solutionSessionId =
      'solution-session:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as never
    expect(
      issuesOf(parseCoreDataAggregate(orphanSubmission)).some(
        ({ code, path }) =>
          code === 'invalid_relation' &&
          path === 'submissions[0].solutionSessionId',
      ),
    ).toBe(true)

    const orphanAI = aggregateFixture()
    orphanAI.aiUsageRecords[0].solutionSessionId =
      'solution-session:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as never
    expect(
      issuesOf(parseCoreDataAggregate(orphanAI)).some(
        ({ code, path }) =>
          code === 'invalid_relation' &&
          path === 'aiUsageRecords[0].solutionSessionId',
      ),
    ).toBe(true)
  })

  it('preserves independent AI levels for an initial solution and two reviews', () => {
    const aggregate = aggregateFixture()
    const thirdSession = {
      ...structuredClone(aggregate.solutionSessions[1]),
      id: 'solution-session:99999999-9999-4999-8999-999999999999',
      solvedAt: '2026-08-08T09:00:00.000Z',
      createdAt: '2026-08-08T09:00:00.000Z',
      updatedAt: '2026-08-08T09:00:00.000Z',
    } as SolutionSession
    const thirdAI = {
      ...structuredClone(aggregate.aiUsageRecords[2]),
      id: 'ai-usage:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      solutionSessionId: thirdSession.id,
      recordedAt: '2026-08-08T09:00:01.000Z',
      createdAt: '2026-08-08T09:00:00.000Z',
      updatedAt: '2026-08-08T09:00:01.000Z',
    } as AIUsageRecord
    aggregate.solutionSessions.push(thirdSession)
    aggregate.aiUsageRecords.push(thirdAI)

    const result = parseCoreDataAggregate(aggregate)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const sessions = result.value.solutionSessions.filter(
        ({ problemId }) => problemId === aggregate.problems[0].id,
      )
      const levels = sessions.map(
        ({ id }) =>
          result.value.aiUsageRecords.find(
            ({ solutionSessionId }) => solutionSessionId === id,
          )?.level,
      )
      expect(sessions).toHaveLength(3)
      expect(levels).toEqual(['partial-hint', 'none', 'unrecorded'])
    }
  })

  it('detects strong, weak and conflicting Problem candidates', () => {
    const left = aggregateFixture().problems[0]
    const sameNumber = {
      ...left,
      id: 'problem:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      platformProblemId: 'different',
    } as Problem
    const sameTitleOnly = {
      ...left,
      id: 'problem:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      platformProblemId: undefined,
      problemNumber: undefined,
      url: undefined,
      title: '  VIEW  ',
    } as Problem
    const otherPlatform = { ...sameNumber, platform: 'leetcode' } as Problem

    expect(compareProblems(left, sameNumber).kind).toBe('duplicate_conflict')
    expect(compareProblems(left, sameTitleOnly)).toMatchObject({
      kind: 'candidate',
      strength: 'weak',
      autoMerge: false,
    })
    expect(compareProblems(left, otherPlatform).kind).toBe('none')

    expect(
      normalizeProblemUrl(
        'https://EXAMPLE.com/problem/1206/?b=2&a=1#submission',
      ),
    ).toBe('https://example.com/problem/1206?a=1&b=2')
    expect(normalizeTitle('  ＶＩＥＷ　문제  ')).toBe('view 문제')
  })

  it('detects code hashes as weak session candidates without auto-merge', () => {
    const left = {
      ...aggregateFixture().solutionSessions[0],
      codeHash: 'a'.repeat(64),
    } as SolutionSession
    const right = {
      ...aggregateFixture().solutionSessions[1],
      codeHash: 'a'.repeat(64),
    } as SolutionSession

    expect(compareSolutionSessions(left, right)).toMatchObject({
      kind: 'candidate',
      strength: 'weak',
      autoMerge: false,
    })

    expect(normalizeGitHubFilePath('./solutions\\SWEA\\1206.java')).toBe(
      'solutions/SWEA/1206.java',
    )
    expect(
      compareSolutionSessions(
        { ...left, codeHash: undefined, githubFilePath: './solutions\\A.java' },
        { ...right, codeHash: undefined, githubFilePath: '/solutions/A.java' },
      ),
    ).toMatchObject({ kind: 'candidate', strength: 'weak' })
  })

  it('rejects the aggregate failure fixture with enum, date and relation paths', () => {
    const invalid = fixture<unknown>('invalid-aggregate.json')
    const issues = issuesOf(parseCoreDataAggregate(invalid))

    expect(issues.some(({ code }) => code === 'invalid_enum')).toBe(true)
    expect(issues.some(({ code }) => code === 'unknown_field')).toBe(true)
    expect(issues.some(({ code }) => code === 'invalid_relation')).toBe(true)
    expect(issues.some(({ path }) => path === 'problems[0].createdAt')).toBe(
      true,
    )
  })
})
