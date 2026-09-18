import type { Solution } from './types'
import { describeLanguage } from '../../../shared/language'

export type ExportSettings = { copyHeader: boolean; downloadHeader: boolean; filenameTemplate: string; gitPathTemplate?: string }
export const DEFAULT_DOWNLOAD_FILENAME_TEMPLATE = 'Solution_{number}_{name}'
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { copyHeader: false, downloadHeader: false, filenameTemplate: DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, gitPathTemplate: '{platform}/{number}-{title}' }
export const DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE = 'Add {platform} {number} solution'
export const EXPORT_SETTINGS_KEY = 'codearchive-export-settings'
export type ExportProfile = { name?: string | null; nickname?: string | null; id?: string | number | null }
export function readExportSettings(): ExportSettings {
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? 'null')
    return { copyHeader: value?.copyHeader === true, downloadHeader: value?.downloadHeader === true,
      filenameTemplate: typeof value?.filenameTemplate === 'string' ? value.filenameTemplate.slice(0, 160) : DEFAULT_EXPORT_SETTINGS.filenameTemplate,
      gitPathTemplate: typeof value?.gitPathTemplate === 'string' ? value.gitPathTemplate.slice(0, 240) : DEFAULT_EXPORT_SETTINGS.gitPathTemplate }
  } catch { return { ...DEFAULT_EXPORT_SETTINGS } }
}
export function sourceFileExtension(language: string) {
  return describeLanguage(language).extension
}
export function exportCode(solution: Solution, header: boolean): string {
  if (!header) return solution.sourceCode
  const ext = sourceFileExtension(solution.language)
  const prefix = ['py', 'rb'].includes(ext) ? '#' : ext === 'sql' ? '--' : ext === 'txt' ? '' : '//'
  // Unknown languages have no safe universal comment syntax.
  if (!prefix) return solution.sourceCode
  const clean = (value: string) => {
    const line = value.replace(/[\r\n\u2028\u2029]/g, ' ')
    // Java expands Unicode escapes before tokenizing comments. Metadata must
    // never contain a backslash escape that can introduce a source newline.
    return ext === 'java' ? line.replace(/\\/g, '/') : line
  }
  const lines = [`${solution.platform} #${solution.problemNumber} · ${solution.title}`, solution.problemUrl, `Language: ${solution.language}`]
  if (solution.executionTime !== undefined) lines.push(`Execution Time: ${solution.executionTime} ms`)
  if (solution.memoryValue !== undefined && solution.memoryUnit && solution.memoryUnit !== 'UNKNOWN') {
    lines.push(`Memory: ${solution.memoryValue} ${solution.memoryUnit}`)
  } else if (solution.memoryUsage !== undefined) {
    lines.push(`Memory: ${solution.memoryUsage} (unit unknown)`)
  }
  const headerText = lines.map(line => `${prefix} ${clean(line)}`).join('\n') + '\n\n'
  // Preserve interpreter directives at the first line.
  if (solution.sourceCode.startsWith('#!')) {
    const end = solution.sourceCode.indexOf('\n')
    if (end >= 0) return solution.sourceCode.slice(0, end + 1) + headerText + solution.sourceCode.slice(end + 1)
  }
  return headerText + solution.sourceCode
}
export function downloadFilename(solution: Solution, template: string, profile: ExportProfile = {}): string {
  const values: Record<string, string> = { platform: solution.platform, number: solution.problemNumber, title: solution.title, language: solution.language, name: profile.name?.trim() ?? '', nickname: profile.nickname?.trim() ?? '', id: profile.id == null ? '' : String(profile.id) }
  const extension = sourceFileExtension(solution.language)
  let name = (template.trim() || DEFAULT_EXPORT_SETTINGS.filenameTemplate)
    .replace(/\{([^{}]+)\}/g, (_, token: string) => values[token] ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/[. ]+$/g, '').replace(/^\.+/, '').trim()
  name = name.replace(/\.(java|kt|py|js|ts|c|cpp|cs|go|rs|rb|swift|scala|sql|txt)$/i, '')
  name = name.slice(0, 120).replace(/[. ]+$/g, '') || 'solution'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return `${name}.${extension}`
}

/** Git paths are deliberately separate from download names and always relative. */
export function gitPath(solution: Solution, template: string, profile: ExportProfile = {}): string | null {
  const values: Record<string, string> = { platform: solution.platform, number: solution.problemNumber, title: solution.title, language: solution.language, name: profile.name?.trim() ?? '', nickname: profile.nickname?.trim() ?? '', id: profile.id == null ? '' : String(profile.id) }
  const raw = (template || DEFAULT_EXPORT_SETTINGS.gitPathTemplate!).replace(/\{([^{}]+)\}/g, (_, token: string) => values[token] ?? '')
  if (!raw || /^[\\/]|^[a-z]:/i.test(raw) || raw.includes('..') || /[\x00-\x1f\x7f]/.test(raw)) return null
  const path = raw.split('/').map(segment => segment.replace(/[<>:"\\|?*]/g, '-').replace(/[. ]+$/g, '')).filter(Boolean).join('/')
  if (!path) return null
  const ext = sourceFileExtension(solution.language)
  return `${path.replace(/\.(java|kt|py|js|ts|c|cpp|cs|go|rs|rb|swift|scala|sql|txt)$/i, '')}.${ext}`
}

export function githubCommitMessage(solution: Solution, template: string, profile: ExportProfile = {}): string {
  const values: Record<string, string> = {
    Platform: solution.platform,
    platform: solution.platform,
    number: solution.problemNumber,
    title: solution.title,
    language: solution.language,
    name: profile.name?.trim() ?? '',
    nickname: profile.nickname?.trim() ?? '',
    id: profile.id == null ? '' : String(profile.id),
  }
  const rendered = (template || DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE)
    .replace(/\{([^{}]+)\}/g, (_, token: string) => values[token] ?? '')
    .replace(/[\r\n\u2028\u2029\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (rendered || `Add ${solution.platform} ${solution.problemNumber} solution`).slice(0, 200).trim()
}
