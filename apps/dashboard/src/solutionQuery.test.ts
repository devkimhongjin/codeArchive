import { describe, expect, it } from 'vitest'
import { filterAndSortSolutions, groupSolutions } from './solutionQuery'
import type { Solution } from './types'

const solution = (captureId: string, language: string, problemNumber: string, title: string, solvedAt: string, platform: Solution['platform'] = 'SWEA'): Solution => ({
  captureId, language, problemNumber, title, solvedAt, platform,
  problemUrl: 'https://example.test/problem', sourceCode: 'code', result: 'ACCEPTED',
})

const values = [
  solution('b', 'JAVA', '10', '나 문제', '2026-01-02T00:00:00Z'),
  solution('a', 'Java 17', '2', '가 문제', '2026-01-03T00:00:00Z'),
  solution('c', 'Python3', '1', '다 문제', '2026-01-01T00:00:00Z', 'PROGRAMMERS'),
]

describe('solution query', () => {
  it('combines query, platform and canonical language filters', () => {
    expect(filterAndSortSolutions(values, { query: '문제', platform: 'SWEA', languageKey: 'java', sort: 'latest' }).map(x => x.captureId)).toEqual(['a', 'b'])
  })

  it('supports stable date and natural problem ordering', () => {
    expect(filterAndSortSolutions(values, { query: '', platform: 'ALL', languageKey: 'ALL', sort: 'oldest' }).map(x => x.captureId)).toEqual(['c', 'b', 'a'])
    expect(filterAndSortSolutions(values, { query: '', platform: 'ALL', languageKey: 'ALL', sort: 'problem' }).map(x => x.problemNumber)).toEqual(['1', '2', '10'])
  })

  it('groups only matching platform and problem identities while retaining submission history', () => {
    const grouped = groupSolutions(values)
    expect(grouped).toHaveLength(3)
    const sameProblem = groupSolutions([...values, solution('d', 'Kotlin', '10', '새 제목', '2026-01-04T00:00:00Z')])[0]
    expect(sameProblem.key).toBe('SWEA:10')
    expect(sameProblem.title).toBe('새 제목')
    expect(sameProblem.submissions.map(x => x.captureId)).toEqual(['d', 'b'])
  })
})
