// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { readCommunityRoute, readView, urlForView } from './communityRoute'

afterEach(() => window.history.replaceState({}, '', '/'))

it('restores an exact community problem, filter, page, and detail from the URL', () => {
  const route = readCommunityRoute('?view=community&platform=PROGRAMMERS&problemNumber=123_ABC&languageKey=java&page=2&solution=42')
  expect(readView('?view=community')).toBe('community')
  expect(route).toEqual({ platform: 'PROGRAMMERS', problemNumber: '123_ABC', languageKey: 'java', page: 2, detailId: 42 })
  expect(urlForView('community', route, new URL('https://example.test/'))).toBe('/?view=community&platform=PROGRAMMERS&problemNumber=123_ABC&languageKey=java&page=2&solution=42')
})

it('rejects malformed route values and removes private community context on other tabs', () => {
  const route = readCommunityRoute('?view=community&platform=other&problemNumber=../secret&languageKey=JAVA%0A&page=9999&solution=-1')
  expect(route).toEqual({ platform: 'SWEA', problemNumber: '', languageKey: '', page: 0, detailId: null })
  expect(urlForView('solutions', route, new URL('https://example.test/?view=community&platform=SWEA&problemNumber=123&solution=42'))).toBe('/')
  expect(urlForView('github', route, new URL('https://example.test/?view=community&platform=SWEA&problemNumber=123&solution=42'))).toBe('/?view=github')
  expect(readView('?view=github')).toBe('github')
  expect(readView('?view=settings')).toBe('settings')
  expect(readView('?view=history')).toBe('history')
  expect(urlForView('history', route, new URL('https://example.test/?view=community&platform=SWEA&problemNumber=123'))).toBe('/?view=history')
  expect(readView('?view=unsupported')).toBe('solutions')
})

it('keeps an exact Jungol problem in a shared community link', () => {
  const route = readCommunityRoute('?view=community&platform=JUNGOL&problemNumber=1520')
  expect(route.platform).toBe('JUNGOL')
  expect(urlForView('community', route, new URL('https://example.test/'))).toBe('/?view=community&platform=JUNGOL&problemNumber=1520')
})

it('preserves server sorting through links and removes it on other views', () => {
  const route = readCommunityRoute('?view=community&platform=SWEA&problemNumber=1234&sort=likes&page=2')
  expect(route.sort).toBe('likes')
  expect(urlForView('community', route, new URL('https://example.test/'))).toContain('sort=likes&page=2')
  expect(urlForView('settings', route, new URL('https://example.test/?sort=likes'))).toBe('/?view=settings')
  expect(readCommunityRoute('?sort=source_code').sort).toBeUndefined()
})
