import { describe, expect, it } from 'vitest'
import { analyzeSource, MAX_ANALYSIS_LENGTH } from './staticAnalysis'

describe('deterministic text-only static analysis', () => {
  it('parses Java and reports an empty catch without executing code', () => {
    const result = analyzeSource('Java 21', 'class Main { void run() { try { throw new Exception(); } catch (Exception e) {} } }')
    expect(result.status).toBe('success'); expect(result.diagnostics.map(item => item.rule)).toEqual(['java/empty-catch'])
    expect(result).toEqual(analyzeSource('Java', 'class Main { void run() { try { throw new Exception(); } catch (Exception e) {} } }'))
  })
  it('parses JavaScript and TypeScript, preserving numeric locations', () => {
    expect(analyzeSource('JavaScript', 'var x = 1;\nif (x == 1) { debugger; }').diagnostics.map(item => item.rule)).toEqual(['js/no-var', 'js/strict-equality', 'js/no-debugger'])
    expect(analyzeSource('TypeScript', 'const x: number = 1;').status).toBe('success')
    expect(analyzeSource('JavaScript', 'const x: number = 1;').status).toBe('syntax_error')
  })
  it('parses Python and flags bare except, with recovery errors distinguished', () => {
    expect(analyzeSource('Python3', 'try:\n print(1)\nexcept:\n pass\n').diagnostics[0].rule).toBe('python/bare-except')
    expect(analyzeSource('PyPy3', 'def f(:\n return 1\n').status).toBe('syntax_error')
  })
  it('never executes submitted loops, filesystem, network or eval calls', () => {
    const source = 'while(true) { fetch("https://example.test"); eval("globalThis.analysisExecuted = true"); }'
    expect(analyzeSource('JavaScript', source).status).toBe('success')
    expect((globalThis as Record<string, unknown>).analysisExecuted).toBeUndefined()
    expect(analyzeSource('Python', 'while True:\n open("private.txt", "w")\n').status).toBe('success')
  })
  it('does not mistake rules inside comments and strings for code', () => {
    expect(analyzeSource('JavaScript', '// var x == 1; debugger;\nconst text = "eval(x)";').diagnostics).toEqual([])
    expect(analyzeSource('Python', 'text = "except:"\n# except:\n').diagnostics).toEqual([])
  })
  it('bounds inputs and returns only fixed syntax messages', () => {
    expect(analyzeSource('Java', 'x'.repeat(MAX_ANALYSIS_LENGTH + 1)).status).toBe('limit')
    expect(analyzeSource('C++', 'int main() {}').status).toBe('unsupported')
    const result = analyzeSource('Java', 'private_secret_not_to_echo')
    expect(result.status).toBe('syntax_error'); expect(JSON.stringify(result)).not.toContain('private_secret')
  })
})
