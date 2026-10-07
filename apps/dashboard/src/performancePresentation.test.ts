import { describe, expect, it } from 'vitest'
import { formatExecutionTime, formatMemory } from './performancePresentation'

describe('performance presentation', () => {
  it('truncates final execution time and memory values instead of rounding', () => {
    expect(formatExecutionTime(747.0900000000003)).toBe('747 ms')
    expect(formatExecutionTime(9.99)).toBe('9 ms')
    expect(formatExecutionTime(0.9)).toBe('0 ms')
    expect(formatExecutionTime(0)).toBe('0 ms')
    expect(formatMemory({ memoryValue: 123.37931034482759, memoryUnit: 'MB' })).toBe('123 MB')
    expect(formatMemory({ memoryValue: '9.99', memoryUnit: 'KB' })).toBe('9 KB')
  })

  it('keeps missing and invalid values distinct from a real zero', () => {
    expect(formatExecutionTime(undefined)).toBe('정보 없음')
    expect(formatExecutionTime(Number.NaN)).toBe('정보 없음')
    expect(formatExecutionTime(Number.POSITIVE_INFINITY)).toBe('정보 없음')
    expect(formatExecutionTime(-1)).toBe('정보 없음')
    expect(formatMemory({ memoryValue: 0, memoryUnit: 'MB' })).toBe('0 MB')
    expect(formatMemory({ memoryUsage: '12.5' })).toBe('12 · 단위 미확인')
    expect(formatMemory({ memoryValue: 'not-a-number', memoryUnit: 'MB' })).toBe('정보 없음')
  })
})
