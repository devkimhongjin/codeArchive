import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalLanguageKey, describeLanguage } from '../../../shared/language'

test('platform aliases share one canonical language contract', () => {
  for (const alias of ['Java', 'JAVA', 'Java 17', 'JAVA (OpenJDK 8)']) {
    assert.equal(canonicalLanguageKey(alias), 'java')
    assert.equal(describeLanguage(alias).extension, 'java')
  }
  for (const alias of ['Python3', 'Python 3', 'PyPy3']) {
    assert.equal(canonicalLanguageKey(alias), 'python')
    assert.equal(describeLanguage(alias).shikiLanguage, 'python')
  }
  assert.equal(canonicalLanguageKey('JavaScript'), 'javascript')
  assert.equal(canonicalLanguageKey('C++17'), 'cpp')
  assert.match(canonicalLanguageKey('Brainf***'), /^unknown:/)
})
