import { describe, expect, it, vi } from 'vitest'
import { EXTENSION_RELEASE, fetchLatestExtensionRelease, isVersionAtLeast } from './extensionRelease'

const metadata = (version = '0.2.0', minimumDashboardVersion = '0.2.0') => ({
  schemaVersion: 1,
  version,
  releasedAt: '2026-09-18',
  commit: 'a'.repeat(40),
  extensionId: EXTENSION_RELEASE.id,
  minimumChromeVersion: EXTENSION_RELEASE.minimumChromeVersion,
  compatibility: { minimumDashboardVersion, minimumApiVersion: '0.2.0', dashboardMinimumExtensionVersion: '0.2.0' },
  artifact: { name: 'codearchive-extension.zip', sha256: 'b'.repeat(64) },
})

const githubRelease = (version: string, releaseMetadata = metadata(version)) => {
  const tag = `extension-v${version}`
  const base = `https://github.com/devkimhongjin/codeArchive/releases/download/${tag}`
  return {
    draft: false,
    prerelease: true,
    tag_name: tag,
    html_url: `https://github.com/devkimhongjin/codeArchive/releases/tag/${tag}`,
    assets: [
      { name: 'codearchive-extension.zip', browser_download_url: `${base}/codearchive-extension.zip`, digest: `sha256:${releaseMetadata.artifact.sha256}` },
      { name: 'codearchive-extension-metadata.json', browser_download_url: `${base}/codearchive-extension-metadata.json` },
      { name: 'codearchive-extension.zip.sha256', browser_download_url: `${base}/codearchive-extension.zip.sha256` },
    ],
    body: `CodeArchive beta extension.\n\n<!-- codearchive-extension-metadata\n${JSON.stringify(releaseMetadata)}\n-->`,
  }
}

describe('extension release metadata', () => {
  it('compares strict semantic versions', () => {
    expect(isVersionAtLeast('0.2.0', '0.2.0')).toBe(true)
    expect(isVersionAtLeast('0.3.0', '0.2.9')).toBe(true)
    expect(isVersionAtLeast('0.1.9', '0.2.0')).toBe(false)
    expect(isVersionAtLeast('dev', '0.2.0')).toBe(false)
  })

  it('loads the newest compatible prerelease from the pinned repository', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [githubRelease('0.3.0', metadata('0.3.0', '0.3.0')), githubRelease('0.2.0')],
    })
    const result = await fetchLatestExtensionRelease(fetcher as typeof fetch, 5000, '0.2.0')
    expect(result.version).toBe('0.2.0')
    expect(result.downloadUrl).toContain('/extension-v0.2.0/codearchive-extension.zip')
    expect(fetcher).toHaveBeenNthCalledWith(1, EXTENSION_RELEASE.releaseListUrl, expect.objectContaining({ cache: 'no-store' }))
  })

  it('rejects metadata or assets that are not bound to the release tag and fixed extension', async () => {
    const wrongAsset = githubRelease('0.2.0')
    wrongAsset.assets[0].browser_download_url = 'https://example.com/codearchive-extension.zip'
    const badAssets = vi.fn().mockResolvedValue({ ok: true, json: async () => [wrongAsset] })
    await expect(fetchLatestExtensionRelease(badAssets as typeof fetch)).rejects.toThrow('호환되는')

    const badMetadata = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [githubRelease('0.2.0', { ...metadata(), extensionId: 'a'.repeat(32) })],
    })
    await expect(fetchLatestExtensionRelease(badMetadata as typeof fetch)).rejects.toThrow('호환되는')
  })
})
