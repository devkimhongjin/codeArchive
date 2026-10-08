import { normalizeDifficulty, type ProblemDifficulty } from '../../../shared/difficulty'

export function sweaDifficulty(document: Document, problemNumber: string, problemUrl: string): ProblemDifficulty | undefined {
  const headings = document.querySelectorAll('.problem_box > h3, .problem_box .problem_title')
  if (headings.length !== 1) return
  const heading = headings[0]!, number = heading.textContent?.trim().match(/^(\d+)\./)?.[1]
  const badges = heading.querySelectorAll('.badge')
  if (number !== problemNumber || badges.length !== 1) return
  return normalizeDifficulty('SWEA', problemNumber, problemUrl, { label: badges[0]!.textContent?.trim(), problemNumber, sourceUrl: problemUrl })
}
export function programmersListingDifficulty(row: Element, problemNumber: string, problemUrl: string): ProblemDifficulty | undefined {
  const links = row.querySelectorAll('td.title a[href^="/learn/courses/30/lessons/"]'), levels = row.querySelectorAll('td.level > span')
  if (links.length !== 1 || links[0]!.getAttribute('href') !== `/learn/courses/30/lessons/${problemNumber}` || levels.length !== 1) return
  const label = levels[0]!.textContent?.trim(), level = label?.match(/^Lv\. ([0-5])$/)?.[1]
  if (!level || !levels[0]!.classList.contains(`level-${level}`)) return
  return normalizeDifficulty('PROGRAMMERS', problemNumber, problemUrl, { label, problemNumber, sourceUrl: 'https://school.programmers.co.kr/learn/challenges' })
}
