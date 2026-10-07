import { describe, expect, it } from 'vitest'
import { canonicalLanguageDisplayName, canonicalLanguageKey, describeLanguage } from '../../../shared/language'

describe('canonical language contract', () => {
  it.each(['Java', 'JAVA', 'Java 17', 'JAVA (OpenJDK 8)'])('groups %s as Java', (alias) => {
    expect(canonicalLanguageKey(alias)).toBe('java')
    expect(canonicalLanguageDisplayName(alias)).toBe('Java')
    expect(describeLanguage(alias).extension).toBe('java')
    expect(describeLanguage(alias).shikiLanguage).toBe('java')
  })

  it('preserves an explicit fallback identity for unknown languages', () => {
    expect(canonicalLanguageKey('Brainf***')).toMatch(/^unknown:/)
    expect(describeLanguage('Brainf***')).toMatchObject({ displayName: 'Brainf***', extension: 'txt', shikiLanguage: null })
  })
})
