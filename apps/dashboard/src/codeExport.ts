import type { Solution } from './types'
import { describeLanguage } from '../../../shared/language'
import { codeWithHeader, DEFAULT_HEADER_FIELDS, normalizedHeaderFields, type HeaderField } from '../../../shared/headerFields'

export type ExportSettings = { copyHeader: boolean; downloadHeader: boolean; copyHeaderFields?: HeaderField[]; downloadHeaderFields?: HeaderField[]; filenameTemplate: string; gitPathTemplate?: string }
export const DEFAULT_DOWNLOAD_FILENAME_TEMPLATE = 'Solution_{number}_{name}'
export const DEFAULT_GIT_PATH_TEMPLATE = '{platform}/{number}_{title}/{time}'
export const GIT_PATH_TOKENS = ['{platform}', '{number}', '{title}', '{language}', '{name}', '{nickname}', '{id}', '{time}', '{capture_ID}'] as const
export const FILENAME_TOKENS = GIT_PATH_TOKENS
export const COMMIT_MESSAGE_TOKENS = GIT_PATH_TOKENS
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { copyHeader: false, downloadHeader: false, copyHeaderFields: [...DEFAULT_HEADER_FIELDS], downloadHeaderFields: [...DEFAULT_HEADER_FIELDS], filenameTemplate: DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, gitPathTemplate: DEFAULT_GIT_PATH_TEMPLATE }
export const DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE = 'Add {platform} {number} solution'
export const EXPORT_SETTINGS_KEY = 'codearchive-export-settings'
export type ExportProfile = { name?: string | null; nickname?: string | null; id?: string | number | null }
export function readExportSettings(): ExportSettings {
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? 'null')
    return { copyHeader: value?.copyHeader === true, downloadHeader: value?.downloadHeader === true,
      copyHeaderFields: normalizedHeaderFields(value?.copyHeaderFields),
      downloadHeaderFields: normalizedHeaderFields(value?.downloadHeaderFields),
      filenameTemplate: typeof value?.filenameTemplate === 'string' ? value.filenameTemplate.slice(0, 160) : DEFAULT_EXPORT_SETTINGS.filenameTemplate,
      gitPathTemplate: typeof value?.gitPathTemplate === 'string' ? value.gitPathTemplate.slice(0, 240) : DEFAULT_EXPORT_SETTINGS.gitPathTemplate }
  } catch { return { ...DEFAULT_EXPORT_SETTINGS } }
}
export function sourceFileExtension(language: string) {
  return describeLanguage(language).extension
}
export function exportCode(solution: Solution, header: boolean, fields: readonly HeaderField[] = DEFAULT_HEADER_FIELDS): string {
  return codeWithHeader(solution, header, fields)
}
export function downloadFilename(solution: Solution, template: string, profile: ExportProfile = {}): string {
  const values: Record<string, string> = { platform: solution.platform, number: solution.problemNumber, title: solution.title, language: solution.language, name: profile.name?.trim() ?? '', nickname: profile.nickname?.trim() ?? '', id: profile.id == null ? '' : String(profile.id), time: gitPathTime(solution.solvedAt ?? solution.observedAt), capture_ID: solution.captureId }
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
export function gitPath(solution: Pick<Solution, 'captureId' | 'platform' | 'problemNumber' | 'title' | 'language' | 'solvedAt' | 'observedAt'>, template: string, profile: ExportProfile = {}): string | null {
  const values: Record<string, string> = { platform: solution.platform, number: solution.problemNumber, title: solution.title, language: solution.language, name: profile.name?.trim() ?? '', nickname: profile.nickname?.trim() ?? '', id: profile.id == null ? '' : String(profile.id), time: gitPathTime(solution.solvedAt ?? solution.observedAt), capture_ID: solution.captureId }
  Object.keys(values).forEach(key => { values[key] = gitPathToken(values[key]) })
  const raw = (template || DEFAULT_EXPORT_SETTINGS.gitPathTemplate!).replace(/\{([^{}]+)\}/g, (_, token: string) => values[token] ?? '')
  if (!raw || /^[\\/]|^[a-z]:/i.test(raw) || raw.includes('..') || /[\x00-\x1f\x7f]/.test(raw)) return null
  const path = raw.split('/').map(segment => segment.replace(/[<>:"\\|?*]/g, '-').replace(/[. ]+$/g, '')).filter(Boolean).join('/')
  if (!path) return null
  const ext = sourceFileExtension(solution.language)
  return `${path.replace(/\.(java|kt|py|js|ts|c|cpp|cs|go|rs|rb|swift|scala|sql|txt)$/i, '')}.${ext}`
}

function gitPathToken(value: string): string {
  return value.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-').replace(/[. ]+$/g, '').replace(/^\.+/, '').trim()
}

export function hasGitSubmissionIdentityToken(template: string): boolean {
  return template.includes('{capture_ID}') || template.includes('{time}')
}

function gitPathTime(value?: string): string {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return 'unknown-time'
  const iso = date.toISOString()
  return `${iso.slice(2, 10).replace(/-/g, '')}${iso.slice(11, 19).replace(/:/g, '')}`
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
    time: gitPathTime(solution.solvedAt ?? solution.observedAt),
    capture_ID: solution.captureId,
  }
  const rendered = (template || DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE)
    .replace(/\{([^{}]+)\}/g, (_, token: string) => values[token] ?? '')
    .replace(/[\r\n\u2028\u2029\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (rendered || `Add ${solution.platform} ${solution.problemNumber} solution`).slice(0, 200).trim()
}
