export type ProblemDifficulty = { label: string; problemNumber: string; sourceUrl: string }
/** Site-local scales only. Never map a Jungol number to a BOJ/solved.ac tier. */
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
  } catch { /* Unknown source stays blank. */ }
}
export function difficultyKey(platform: string, value?: ProblemDifficulty): string { return value ? `${platform}:${value.label}` : 'UNKNOWN' }
