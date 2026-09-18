import release from '../../../release.json'

export interface ExtensionReleaseMetadata {
  schemaVersion: 1
  version: string
  releasedAt: string
  commit: string
  extensionId: string
  minimumChromeVersion: string
  compatibility: {
    minimumDashboardVersion: string
    minimumApiVersion: string
    dashboardMinimumExtensionVersion: string
  }
  artifact: { name: 'codearchive-extension.zip'; sha256: string }
}

export interface ExtensionReleaseInfo extends ExtensionReleaseMetadata {
  releasePageUrl: string
  downloadUrl: string
  checksumUrl: string
}

const extension = release.extension
export const EXTENSION_RELEASE = {
  version: release.version,
  id: extension.id,
  minimumChromeVersion: extension.minimumChromeVersion,
  minimumExtensionVersion: extension.compatibility.dashboardMinimumExtensionVersion,
  releaseListUrl: extension.releaseListUrl,
  releaseHistoryUrl: extension.releaseHistoryUrl,
} as const

const SEMVER = /^\d+\.\d+\.\d+$/
const TAG = /^extension-v(\d+\.\d+\.\d+)$/
const ASSET_NAMES = {
  archive: 'codearchive-extension.zip',
  metadata: 'codearchive-extension-metadata.json',
  checksum: 'codearchive-extension.zip.sha256',
} as const

interface GitHubAsset {
  name: string
  browser_download_url: string
  digest?: string | null
}

interface GitHubRelease {
  draft: boolean
  tag_name: string
  html_url: string
  body: string | null
  assets: GitHubAsset[]
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  if (!SEMVER.test(version) || !SEMVER.test(minimum)) return false
  const actual = version.split('.').map(Number)
  const required = minimum.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index]
  }
  return true
}

function parseMetadata(value: unknown, expectedVersion: string): ExtensionReleaseMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('릴리스 메타데이터가 올바르지 않습니다.')
  const record = value as Record<string, unknown>
  const compatibility = record.compatibility as Record<string, unknown> | undefined
  const artifact = record.artifact as Record<string, unknown> | undefined
  if (
    record.schemaVersion !== 1 || record.version !== expectedVersion || !SEMVER.test(expectedVersion) ||
    typeof record.releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.releasedAt) ||
    typeof record.commit !== 'string' || !/^[a-fA-F0-9]{40}$/.test(record.commit) ||
    record.extensionId !== EXTENSION_RELEASE.id || typeof record.minimumChromeVersion !== 'string' || !/^\d+$/.test(record.minimumChromeVersion) ||
    !compatibility || !SEMVER.test(String(compatibility.minimumDashboardVersion)) ||
    !SEMVER.test(String(compatibility.minimumApiVersion)) || !SEMVER.test(String(compatibility.dashboardMinimumExtensionVersion)) ||
    artifact?.name !== ASSET_NAMES.archive || typeof artifact.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(artifact.sha256)
  ) throw new Error('릴리스 메타데이터가 올바르지 않습니다.')
  return value as ExtensionReleaseMetadata
}

function metadataFromReleaseBody(body: unknown): unknown {
  if (typeof body !== 'string' || body.length > 200_000) return null
  const match = /<!-- codearchive-extension-metadata\s*\n([\s\S]*?)\n-->/.exec(body)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function parseRelease(value: unknown): { version: string; releasePageUrl: string; body: string | null; assets: Record<string, GitHubAsset> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<GitHubRelease>
  const tagMatch = typeof record.tag_name === 'string' ? TAG.exec(record.tag_name) : null
  if (record.draft !== false || !tagMatch || !Array.isArray(record.assets)) return null
  const tag = record.tag_name as string
  const prefix = `https://github.com/devkimhongjin/codeArchive/releases/download/${tag}/`
  const releasePageUrl = `https://github.com/devkimhongjin/codeArchive/releases/tag/${tag}`
  if (record.html_url !== releasePageUrl) return null
  const assets: Record<string, GitHubAsset> = {}
  for (const asset of record.assets) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') continue
    if (!Object.values(ASSET_NAMES).includes(asset.name as typeof ASSET_NAMES[keyof typeof ASSET_NAMES])) continue
    if (asset.browser_download_url !== `${prefix}${asset.name}`) continue
    assets[asset.name] = asset
  }
  return { version: tagMatch[1], releasePageUrl, body: record.body ?? null, assets }
}

async function fetchJson(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error('최신 확장 릴리스를 확인하지 못했습니다.')
  return response.json()
}

export async function fetchLatestExtensionRelease(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
  dashboardVersion = EXTENSION_RELEASE.version,
): Promise<ExtensionReleaseInfo> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const value = await fetchJson(fetcher, EXTENSION_RELEASE.releaseListUrl, controller.signal)
    if (!Array.isArray(value)) throw new Error('릴리스 목록이 올바르지 않습니다.')
    for (const entry of value) {
      const candidate = parseRelease(entry)
      if (!candidate || !isVersionAtLeast(candidate.version, EXTENSION_RELEASE.minimumExtensionVersion)) continue
      const metadataAsset = candidate.assets[ASSET_NAMES.metadata]
      const archiveAsset = candidate.assets[ASSET_NAMES.archive]
      const checksumAsset = candidate.assets[ASSET_NAMES.checksum]
      if (!metadataAsset || !archiveAsset || !checksumAsset) continue
      let metadata: ExtensionReleaseMetadata
      try {
        metadata = parseMetadata(metadataFromReleaseBody(candidate.body), candidate.version)
      } catch {
        continue
      }
      if (archiveAsset.digest !== `sha256:${metadata.artifact.sha256.toLowerCase()}`) continue
      if (!isVersionAtLeast(dashboardVersion, metadata.compatibility.minimumDashboardVersion)) continue
      return {
        ...metadata,
        releasePageUrl: candidate.releasePageUrl,
        downloadUrl: archiveAsset.browser_download_url,
        checksumUrl: checksumAsset.browser_download_url,
      }
    }
    throw new Error('현재 대시보드와 호환되는 확장 릴리스가 없습니다.')
  } finally {
    clearTimeout(timeout)
  }
}
