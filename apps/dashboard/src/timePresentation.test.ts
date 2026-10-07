import { describe, expect, it } from 'vitest'
import { formatKstDate, formatKstDateTime, formatKstTimestamp, formatKstTimeToken } from '../../../shared/timePresentation'
import { downloadFilename, exportCode, githubCommitMessage, gitPath } from './codeExport'
import { demoSolutions } from './demoData'

describe('KST user-facing time', () => {
  it.each([
    ['2025-12-31T15:00:00Z', '2026-01-01 00:00:00', '260101000000'],
    ['2026-01-31T16:05:06.123Z', '2026-02-01 01:05:06', '260201010506'],
    ['2026-03-01T00:00:00+09:00', '2026-03-01 00:00:00', '260301000000'],
  ])('uses the Korea calendar for %s', (instant, timestamp, token) => {
    const solution = { ...demoSolutions[0], language: 'Java', solvedAt: instant }
    expect(formatKstTimestamp(instant)).toBe(timestamp)
    expect(formatKstTimeToken(instant)).toBe(token)
    expect(formatKstDateTime(instant)).toBe(`${timestamp.slice(0, 16)} KST`)
    expect(exportCode(solution, true, ['solvedAt'])).toContain(`Solved At: ${timestamp} KST`)
    expect(downloadFilename(solution, '{time}')).toBe(`${token}.java`)
    expect(gitPath(solution, '{time}')).toBe(`${token}.java`)
    expect(githubCommitMessage(solution, 'Solve {time}')).toBe(`Solve ${token}`)
    expect(solution.solvedAt).toBe(instant)
  })
  it('formats date-only displays on the same KST day and handles missing values', () => {
    expect(formatKstDate('2025-12-31T15:00:00Z')).toBe('2026. 1. 1.')
    expect(formatKstDate('2025-12-31T15:00:00Z', 'missing', true)).toBe('1월 1일')
    expect(formatKstTimestamp('invalid')).toBeNull()
    expect(formatKstTimeToken(undefined)).toBe('unknown-time')
    expect(formatKstDateTime(null)).toBe('정보 없음')
    expect(formatKstDate('invalid', '공개 시각 없음')).toBe('공개 시각 없음')
    const fallback = { ...demoSolutions[0], solvedAt: undefined, observedAt: '2025-12-31T15:00:00Z' }
    expect(exportCode(fallback, true, ['solvedAt'])).toContain('Solved At: 2026-01-01 00:00:00 KST')
  })
})
