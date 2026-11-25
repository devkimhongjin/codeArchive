import { normalizeDifficulty, solvedAcTierLabel, type ProblemDifficulty } from '../../../shared/difficulty'

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
/**
 * Jungol's own tier in the problem heading. The same images also mark members'
 * tiers (lists, profiles), so nothing outside the single heading's tier slot is read.
 */
export function jungolDifficulty(document: Document, problemNumber: string, problemUrl: string): ProblemDifficulty | undefined {
  const headings = document.querySelectorAll('h1')
  if (headings.length !== 1) return
  const slots = headings[0]!.querySelectorAll('.tier'), images = headings[0]!.querySelectorAll('img[src*="/solved/"]')
  if (slots.length !== 1 || images.length !== 1 || !slots[0]!.contains(images[0]!)) return
  try {
    const source = new URL(images[0]!.getAttribute('src') ?? '')
    const level = source.origin === 'https://s.jungol.co.kr' ? source.pathname.match(/^\/solved\/([1-9]\d?)\.svg$/)?.[1] : undefined
    const label = level ? solvedAcTierLabel(Number(level)) : undefined
    return label ? normalizeDifficulty('JUNGOL', problemNumber, problemUrl, { label, problemNumber, sourceUrl: problemUrl }) : undefined
  } catch { return undefined }
}
