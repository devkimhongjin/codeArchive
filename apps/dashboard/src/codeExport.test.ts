import { describe, expect, it } from 'vitest'
import { downloadFilename, exportCode, githubCommitMessage, gitPath, sourceFileExtension } from './codeExport'
import { demoSolutions } from './demoData'
const solution = { ...demoSolutions[0], language: 'Java', sourceCode: '// existing\nclass Main {}', title: '경로/금지:*?' }
describe('code export', () => {
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
