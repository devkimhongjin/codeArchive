import { describe, expect, it } from 'vitest'
import { downloadFilename, exportCode, sourceFileExtension } from './codeExport'
import { demoSolutions } from './demoData'
const solution = { ...demoSolutions[0], language: 'Java', sourceCode: '// existing\nclass Main {}', title: '경로/금지:*?' }
describe('code export', () => {
  it('keeps original comments and adds language-safe metadata only when requested', () => {
    expect(exportCode(solution, false)).toBe(solution.sourceCode)
    expect(exportCode(solution, true)).toContain('// Language: Java\n\n// existing')
    expect(exportCode({ ...solution, language: 'Python', sourceCode: '#!/usr/bin/python\nprint(1)' }, true)).toMatch(/^#!\/usr\/bin\/python\n# /)
    expect(exportCode({ ...solution, language: 'Unknown' }, true)).toBe(solution.sourceCode)
    const injected = exportCode({ ...solution, title: 'title\nmalicious();' }, true)
    expect(injected).not.toContain('\nmalicious();')
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
})
