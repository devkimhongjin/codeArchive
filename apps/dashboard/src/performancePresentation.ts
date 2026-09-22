import type { Solution } from './types'

function displayInteger(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null
}

export function formatExecutionTime(value: Solution['executionTime']): string {
  const integer = displayInteger(value)
  return integer === null ? '정보 없음' : `${integer} ms`
}

export function formatMemory(solution: Pick<Solution, 'memoryValue' | 'memoryUnit' | 'memoryUsage'>): string {
  const memoryValue = displayInteger(solution.memoryValue)
  if (memoryValue !== null && solution.memoryUnit && solution.memoryUnit !== 'UNKNOWN') {
    return `${memoryValue} ${solution.memoryUnit}`
  }

  const memoryUsage = displayInteger(solution.memoryUsage)
  return memoryUsage === null ? '정보 없음' : `${memoryUsage} · 단위 미확인`
}
