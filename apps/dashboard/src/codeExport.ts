import type { Solution } from './types'

export type ExportSettings = { copyHeader: boolean; downloadHeader: boolean; filenameTemplate: string }
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { copyHeader: false, downloadHeader: false, filenameTemplate: '{platform}-{number}-{title}' }
export const EXPORT_SETTINGS_KEY = 'codearchive-export-settings'
export function readExportSettings(): ExportSettings {
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? 'null')
    return { copyHeader: value?.copyHeader === true, downloadHeader: value?.downloadHeader === true,
      filenameTemplate: typeof value?.filenameTemplate === 'string' ? value.filenameTemplate.slice(0, 160) : DEFAULT_EXPORT_SETTINGS.filenameTemplate }
  } catch { return { ...DEFAULT_EXPORT_SETTINGS } }
}
export function sourceFileExtension(language: string) {
  const name = language.toLowerCase()
  if (name.includes('python')) return 'py'
  if (name.includes('javascript') || name === 'js') return 'js'
  if (name.includes('typescript') || name === 'ts') return 'ts'
  if (name.includes('kotlin')) return 'kt'
  if (name.includes('java')) return 'java'
  if (name.includes('c++') || name === 'cpp') return 'cpp'
  if (/^c(?:\s|\d|$)/.test(name)) return 'c'
  if (name === 'c#' || name.includes('csharp')) return 'cs'
  if (name.includes('swift')) return 'swift'
  if (name === 'go') return 'go'
  if (name.includes('rust')) return 'rs'
  if (name.includes('ruby')) return 'rb'
  if (name.includes('sql')) return 'sql'
  return 'txt'
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
  const headerText = lines.map(line => `${prefix} ${clean(line)}`).join('\n') + '\n\n'
  // Preserve interpreter directives at the first line.
  if (solution.sourceCode.startsWith('#!')) {
    const end = solution.sourceCode.indexOf('\n')
    if (end >= 0) return solution.sourceCode.slice(0, end + 1) + headerText + solution.sourceCode.slice(end + 1)
  }
  return headerText + solution.sourceCode
}
export function downloadFilename(solution: Solution, template: string): string {
  const values: Record<string, string> = { platform: solution.platform, number: solution.problemNumber, title: solution.title, language: solution.language }
  const extension = sourceFileExtension(solution.language)
  let name = (template.trim() || DEFAULT_EXPORT_SETTINGS.filenameTemplate)
    .replace(/\{([^{}]+)\}/g, (_, token: string) => values[token] ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/[. ]+$/g, '').replace(/^\.+/, '').trim()
  if (name.toLowerCase().endsWith(`.${extension}`)) name = name.slice(0, -extension.length - 1)
  name = name.slice(0, 120).replace(/[. ]+$/g, '') || 'solution'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return `${name}.${extension}`
}
