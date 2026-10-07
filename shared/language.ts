export type CanonicalLanguage = {
  key: string
  displayName: string
  extension: string
  shikiLanguage: string | null
}

const KNOWN_LANGUAGES: Record<string, Omit<CanonicalLanguage, 'key'>> = {
  java: { displayName: 'Java', extension: 'java', shikiLanguage: 'java' },
  kotlin: { displayName: 'Kotlin', extension: 'kt', shikiLanguage: 'kotlin' },
  python: { displayName: 'Python', extension: 'py', shikiLanguage: 'python' },
  javascript: { displayName: 'JavaScript', extension: 'js', shikiLanguage: 'javascript' },
  typescript: { displayName: 'TypeScript', extension: 'ts', shikiLanguage: 'typescript' },
  c: { displayName: 'C', extension: 'c', shikiLanguage: 'c' },
  cpp: { displayName: 'C++', extension: 'cpp', shikiLanguage: 'cpp' },
  csharp: { displayName: 'C#', extension: 'cs', shikiLanguage: 'csharp' },
  go: { displayName: 'Go', extension: 'go', shikiLanguage: 'go' },
  rust: { displayName: 'Rust', extension: 'rs', shikiLanguage: 'rust' },
  ruby: { displayName: 'Ruby', extension: 'rb', shikiLanguage: 'ruby' },
  swift: { displayName: 'Swift', extension: 'swift', shikiLanguage: 'swift' },
  scala: { displayName: 'Scala', extension: 'scala', shikiLanguage: 'scala' },
  sql: { displayName: 'SQL', extension: 'sql', shikiLanguage: 'sql' },
}

function foldedLanguageName(language: string): string {
  return language.trim().toLowerCase().replace(/[\s_.-]+/g, '')
}

export function canonicalLanguageKey(language: string): string {
  const folded = foldedLanguageName(language)
  if (/^(typescript|ts)(?:\d.*)?$/.test(folded)) return 'typescript'
  if (/^(javascript|js|nodejs)(?:\d.*)?$/.test(folded)) return 'javascript'
  if (/^(python|python3|pypy|pypy3)(?:\d.*)?$/.test(folded)) return 'python'
  if (/^kotlin(?:\d.*)?$/.test(folded)) return 'kotlin'
  if (/^java(?:$|(?:\(|\d|openjdk|jdk).*)/.test(folded)) return 'java'
  if (/^(c\+\+|cpp|g\+\+)(?:\d.*)?$/.test(folded)) return 'cpp'
  if (/^(c#|csharp)(?:\d.*)?$/.test(folded)) return 'csharp'
  if (/^(c|c\(gcc\)|gcc)(?:\d.*)?$/.test(folded)) return 'c'
  if (/^go(?:\d.*)?$/.test(folded)) return 'go'
  if (/^rust(?:\d.*)?$/.test(folded)) return 'rust'
  if (/^ruby(?:\d.*)?$/.test(folded)) return 'ruby'
  if (/^swift(?:\d.*)?$/.test(folded)) return 'swift'
  if (/^scala(?:\d.*)?$/.test(folded)) return 'scala'
  if (/^(sql|mysql|postgresql)(?:\d.*)?$/.test(folded)) return 'sql'
  return `unknown:${folded.slice(0, 80) || 'empty'}`
}

export function describeLanguage(language: string): CanonicalLanguage {
  const key = canonicalLanguageKey(language)
  const known = KNOWN_LANGUAGES[key]
  return known
    ? { key, ...known }
    : { key, displayName: language.trim() || 'Unknown', extension: 'txt', shikiLanguage: null }
}

export function canonicalLanguageDisplayName(language: string): string {
  return describeLanguage(language).displayName
}
