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
})

it('keeps an exact Jungol problem in a shared community link', () => {
  const route = readCommunityRoute('?view=community&platform=JUNGOL&problemNumber=1520')
  expect(route.platform).toBe('JUNGOL')
  expect(urlForView('community', route, new URL('https://example.test/'))).toBe('/?view=community&platform=JUNGOL&problemNumber=1520')
})
