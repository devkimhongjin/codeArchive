import { describe, expect, it } from 'vitest'
import { BUILD_METADATA, buildLabel, updatedLabel } from '../../../shared/buildMetadata'

describe('build metadata', () => {
  it('uses the shared release version and identifies local builds as dev', () => {
    expect(BUILD_METADATA.version).toBe('0.2.0')
    expect(BUILD_METADATA.buildId).toMatch(/^dev\+/)
    expect(BUILD_METADATA.updatedDate).toBe('dev')
    expect(buildLabel()).toMatch(/^v0\.2\.0 · dev\+/)
    expect(updatedLabel()).toBe('Updated dev')
  })
})
