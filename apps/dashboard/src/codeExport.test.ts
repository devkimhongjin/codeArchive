import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_SETTINGS, DEFAULT_GIT_PATH_TEMPLATE, downloadFilename, exportCode, githubCommitMessage, gitPath, hasGitSubmissionIdentityToken, sourceFileExtension } from './codeExport'
import { demoSolutions } from './demoData'
const solution = { ...demoSolutions[0], language: 'Java', sourceCode: '// existing\nclass Main {}', title: '경로/금지:*?' }
describe('code export', () => {
  it('uses the requested filename template for new users', () => {
    expect(DEFAULT_EXPORT_SETTINGS.filenameTemplate).toBe('Solution_{number}_{name}')
    expect(downloadFilename(solution, DEFAULT_EXPORT_SETTINGS.filenameTemplate, { name: 'Kim' })).toBe('Solution_1208_Kim.java')
  })
  it('uses a submission-specific default Git path and renders UTC YYMMDDHHMMSS time', () => {
    expect(DEFAULT_GIT_PATH_TEMPLATE).toBe('{platform}/{number}_{title}/{time}')
    expect(gitPath(solution, DEFAULT_GIT_PATH_TEMPLATE)).toBe('SWEA/1208_경로-금지---/260914042418.java')
    expect(gitPath(solution, 'archive/{capture_ID}')).toBe('archive/demo-swea-1208.java')
    expect(hasGitSubmissionIdentityToken('archive/{number}/{time}')).toBe(true)
    expect(hasGitSubmissionIdentityToken('archive/{capture_ID}')).toBe(true)
    expect(hasGitSubmissionIdentityToken('archive/{number}')).toBe(false)
  })
  it('keeps original comments and adds language-safe metadata only when requested', () => {
    expect(exportCode(solution, false)).toBe(solution.sourceCode)
    expect(exportCode(solution, true)).toContain('// Language: Java')
    expect(exportCode(solution, true)).toContain('\n\n// existing')
    expect(exportCode({ ...solution, executionTime: 123, memoryValue: 2048, memoryUnit: 'KB' }, true)).toContain('// Execution Time: 123 ms\n// Memory: 2048 KB')
    expect(exportCode({ ...solution, language: 'Python', sourceCode: '#!/usr/bin/python\nprint(1)' }, true)).toMatch(/^#!\/usr\/bin\/python\n# /)
    expect(exportCode({ ...solution, language: 'Unknown' }, true)).toBe(solution.sourceCode)
    const injected = exportCode({ ...solution, title: 'title\nmalicious();' }, true)
    expect(injected).not.toContain('\nmalicious();')
    const unicodeEscape = String.raw`title\u000aclass Injected {}`
    expect(exportCode({ ...solution, title: unicodeEscape }, true)).not.toContain(String.raw`\u000a`)
  })
  it('expands names without paths, reserved Windows names or duplicate extensions', () => {
    expect(downloadFilename(solution, '{number}-{title}')).not.toMatch(/[\\/:*?"<>|]/)
    expect(downloadFilename(solution, 'CON')).toBe('_CON.java')
    expect(downloadFilename(solution, '../x.java')).toBe('-x.java')
    expect(downloadFilename(solution, '{unknown}')).toBe('solution.java')
    expect(downloadFilename(solution, 'a'.repeat(300)).length).toBeLessThan(130)
    expect(sourceFileExtension('C++14')).toBe('cpp')
    expect(sourceFileExtension('C')).toBe('c')
  })
  it('uses the immutable profile context in download and Git templates', () => {
    const profile = { name: '홍 길동', nickname: '길동', id: 42 }
    expect(downloadFilename({ ...solution, language: 'Python3' }, '{name}-{nickname}-{id}.java', profile)).toBe('홍 길동-길동-42.py')
    expect(gitPath({ ...solution, language: 'Python3' }, 'archive/{id}/{name}/solution.java', profile)).toBe('archive/42/홍 길동/solution.py')
    expect(githubCommitMessage(solution, 'Add {platform} {number} solution by {nickname}', profile)).toBe('Add SWEA 1208 solution by 길동')
  })
})
