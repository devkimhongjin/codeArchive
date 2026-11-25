export type ProblemDifficulty = { label: string; problemNumber: string; sourceUrl: string }

const SOLVED_AC_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ruby'] as const
const SOLVED_AC_STEPS = ['V', 'IV', 'III', 'II', 'I'] as const
const SOLVED_AC_TIER = /^(Bronze|Silver|Gold|Platinum|Diamond|Ruby) (V|IV|III|II|I)$/
const BAEKJOON_ORIGINS = ['https://acmicpc.net', 'https://www.acmicpc.net']

/** solved.ac levels (and Jungol's own, on the same steps) 1–30 are Bronze V … Ruby I; 0 (unrated) and anything else has no tier. */
export function solvedAcTierLabel(level: unknown): string | undefined {
  if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1 || level > 30) return
  return `${SOLVED_AC_TIERS[Math.floor((level - 1) / 5)]} ${SOLVED_AC_STEPS[(level - 1) % 5]}`
}
/** The public solved.ac API entry the tier is read from, one per Baekjoon problem. */
export function solvedAcProblemSource(problemNumber: string): string {
  return `https://solved.ac/api/v3/problem/show?problemId=${problemNumber}`
}

/**
 * Site-local scales only. Jungol rates its own problems on solved.ac's 30 steps,
 * so its tier comes from its own problem page; never look a Jungol number up as a BOJ problem.
 */
export function normalizeDifficulty(platform: string, problemNumber: string, problemUrl: string, value: unknown): ProblemDifficulty | undefined {
  if (!value || typeof value !== 'object') return
  const difficulty = value as ProblemDifficulty
  if (difficulty.problemNumber !== problemNumber || typeof difficulty.label !== 'string' || typeof difficulty.sourceUrl !== 'string' || difficulty.sourceUrl.length > 2048) return
  try {
    const source = new URL(difficulty.sourceUrl), problem = new URL(problemUrl)
    if (source.protocol !== 'https:' || source.username || source.password || source.port || source.hash) return
    if (platform === 'SWEA' && /^D[1-8]$/.test(difficulty.label) && source.origin === 'https://swexpertacademy.com' && problem.origin === source.origin &&
      ['/main/code/problem/problemDetail.do', '/main/code/userProblem/userProblemDetail.do'].includes(source.pathname) && source.pathname === problem.pathname &&
      source.searchParams.getAll('contestProbId').length === 1 && /^[A-Za-z0-9_-]{1,160}$/.test(source.searchParams.get('contestProbId') ?? '') && source.searchParams.get('contestProbId') === problem.searchParams.get('contestProbId')) return { label: difficulty.label, problemNumber, sourceUrl: `${source.origin}${source.pathname}?contestProbId=${source.searchParams.get("contestProbId")}` }
    if (platform === 'PROGRAMMERS' && /^Lv\. [0-5]$/.test(difficulty.label) && source.origin === 'https://school.programmers.co.kr' && source.pathname === '/learn/challenges' && source.search === '' && problem.origin === source.origin && problem.pathname === `/learn/courses/30/lessons/${problemNumber}` && /^\d{1,40}$/.test(problemNumber)) return { label: difficulty.label, problemNumber, sourceUrl: difficulty.sourceUrl }
    // Baekjoon: the solved.ac tier of this exact problem, read from its public problem API.
    if (platform === 'BAEKJOON' && SOLVED_AC_TIER.test(difficulty.label) && /^\d{1,40}$/.test(problemNumber) && source.href === solvedAcProblemSource(problemNumber) &&
      BAEKJOON_ORIGINS.includes(problem.origin) && problem.pathname === `/problem/${problemNumber}`) return { label: difficulty.label, problemNumber, sourceUrl: source.href }
    if (platform === 'JUNGOL' && SOLVED_AC_TIER.test(difficulty.label) && /^\d{1,40}$/.test(problemNumber) &&
      source.href === `https://jungol.co.kr/problem/${problemNumber}` && problem.href === source.href) return { label: difficulty.label, problemNumber, sourceUrl: source.href }
  } catch { /* Unknown source stays blank. */ }
}
export function difficultyKey(platform: string, value?: ProblemDifficulty): string { return value ? `${platform}:${value.label}` : 'UNKNOWN' }
