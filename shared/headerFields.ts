import { describeLanguage } from './language'

export const HEADER_FIELDS = ['identity', 'title', 'solvedAt', 'language', 'performance', 'url'] as const
export type HeaderField = typeof HEADER_FIELDS[number]
export const DEFAULT_HEADER_FIELDS: HeaderField[] = ['identity', 'title', 'url', 'language', 'performance']
export const HEADER_FIELD_LABELS: Record<HeaderField, string> = {
  identity: '플랫폼·문제 번호',
  title: '문제 이름',
  solvedAt: '풀이 일자',
  language: '언어',
  performance: '실행시간/메모리',
  url: '문제 링크',
}

export function normalizedHeaderFields(value: unknown): HeaderField[] {
  if (!Array.isArray(value)) return [...DEFAULT_HEADER_FIELDS]
  const fields: HeaderField[] = []
  for (const field of value) {
    if (HEADER_FIELDS.includes(field as HeaderField) && !fields.includes(field as HeaderField)) {
      fields.push(field as HeaderField)
    }
  }
  return fields
}

export type HeaderSource = {
  platform: string
  problemNumber: string
  title: string
  problemUrl: string
  language: string
  sourceCode: string
  solvedAt?: string | null
  observedAt?: string | null
  executionTime?: number | string | null
  memoryUsage?: number | string | null
  memoryValue?: number | string | null
  memoryUnit?: string | null
}

function measurement(value: number | string): string {
  const text = String(value)
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : text
}

export function headerLines(source: HeaderSource, fields: readonly HeaderField[]): string[] {
  const selected = new Set(fields)
  const lines: string[] = []
  if (selected.has('identity') && selected.has('title')) lines.push(`${source.platform} #${source.problemNumber} · ${source.title}`)
  else {
    if (selected.has('identity')) lines.push(`${source.platform} #${source.problemNumber}`)
    if (selected.has('title')) lines.push(`Problem: ${source.title}`)
  }
  if (selected.has('url') && source.problemUrl) lines.push(source.problemUrl)
  if (selected.has('solvedAt')) {
    const date = new Date(source.solvedAt || source.observedAt || '')
    if (!Number.isNaN(date.getTime())) lines.push(`Solved At: ${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`)
  }
  if (selected.has('language') && source.language) lines.push(`Language: ${source.language}`)
  if (selected.has('performance')) {
    if (source.executionTime != null) lines.push(`Execution Time: ${measurement(source.executionTime)} ms`)
    if (source.memoryValue != null && source.memoryUnit && source.memoryUnit.toUpperCase() !== 'UNKNOWN') lines.push(`Memory: ${measurement(source.memoryValue)} ${source.memoryUnit}`)
    else if (source.memoryUsage != null) lines.push(`Memory: ${measurement(source.memoryUsage)} (unit unknown)`)
  }
  return lines
}

export function codeWithHeader(source: HeaderSource, enabled: boolean, fields: readonly HeaderField[] = DEFAULT_HEADER_FIELDS): string {
  if (!enabled) return source.sourceCode
  const ext = describeLanguage(source.language).extension
  const prefix = ['py', 'rb'].includes(ext) ? '#' : ext === 'sql' ? '--' : ext === 'txt' ? '' : '//'
  if (!prefix) return source.sourceCode
  const lines = headerLines(source, fields)
  if (!lines.length) return source.sourceCode
  const clean = (value: string) => {
    const line = value.replace(/[\r\n\u2028\u2029]/g, ' ')
    // Java expands Unicode escapes before parsing comments.
    return ext === 'java' ? line.replace(/\\/g, '/') : line
  }
  const header = lines.map(line => `${prefix} ${clean(line)}`).join('\n') + '\n\n'
  if (source.sourceCode.startsWith('#!')) {
    const end = source.sourceCode.indexOf('\n')
    if (end >= 0) return source.sourceCode.slice(0, end + 1) + header + source.sourceCode.slice(end + 1)
  }
  return header + source.sourceCode
}
