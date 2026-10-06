import { describe, expect, it } from 'vitest'
import { BUILD_METADATA, buildLabel, updatedLabel } from '../../../shared/buildMetadata'
import release from '../../../release.json'

describe('build metadata', () => {
  it('uses the shared release version and identifies local builds as dev', () => {
    expect(BUILD_METADATA.version).toBe(release.version)
    expect(BUILD_METADATA.buildId).toMatch(/^dev\+/)
    expect(BUILD_METADATA.updatedDate).toBe('dev')
    expect(buildLabel()).toBe(`v${release.version} · ${BUILD_METADATA.buildId}`)
    expect(updatedLabel()).toBe('Updated dev')
  })
})
