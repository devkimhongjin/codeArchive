import type { Platform, Solution } from './types'
import { canonicalLanguageKey } from '../../../shared/language'

export type SolutionSort = 'latest' | 'oldest' | 'problem' | 'title'

export type SolutionQuery = {
  query: string
  platform: 'ALL' | Platform
  languageKey: string
  sort: SolutionSort
}

export type SolutionGroup = {
  key: string
  platform: Platform
  problemNumber: string
  title: string
  submissions: Solution[]
}

const natural = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })

function timestamp(solution: Solution): number {
  const value = Date.parse(solution.solvedAt ?? solution.observedAt ?? '')
  return Number.isNaN(value) ? 0 : value
}

function stableCaptureOrder(left: Solution, right: Solution): number {
  return left.captureId.localeCompare(right.captureId)
}

export function filterAndSortSolutions(solutions: Solution[], options: SolutionQuery): Solution[] {
  const query = options.query.trim().toLocaleLowerCase('ko-KR')
  return solutions
    .filter((solution) => {
      const languageKey = solution.languageKey ?? canonicalLanguageKey(solution.language)
      const matchesQuery = !query || [solution.title, solution.problemNumber, solution.language, languageKey, solution.platform]
        .some((field) => field.toLocaleLowerCase('ko-KR').includes(query))
      return matchesQuery
        && (options.platform === 'ALL' || solution.platform === options.platform)
        && (options.languageKey === 'ALL' || languageKey === options.languageKey)
    })
    .sort((left, right) => {
      let compared = 0
      if (options.sort === 'latest') compared = timestamp(right) - timestamp(left)
      else if (options.sort === 'oldest') compared = timestamp(left) - timestamp(right)
      else if (options.sort === 'problem') compared = natural.compare(left.problemNumber, right.problemNumber)
      else compared = natural.compare(left.title, right.title)
      return compared || stableCaptureOrder(left, right)
    })
}

export function groupSolutions(solutions: Solution[]): SolutionGroup[] {
  const groups = new Map<string, Solution[]>()
  for (const solution of solutions) {
    const key = `${solution.platform}:${solution.problemNumber}`
    const submissions = groups.get(key)
    if (submissions) submissions.push(solution)
    else groups.set(key, [solution])
  }
  return Array.from(groups, ([key, submissions]) => {
    const newestFirst = [...submissions].sort((left, right) => timestamp(right) - timestamp(left) || stableCaptureOrder(left, right))
    const latest = newestFirst[0]!
    return { key, platform: latest.platform, problemNumber: latest.problemNumber, title: latest.title, submissions: newestFirst }
  })
}
