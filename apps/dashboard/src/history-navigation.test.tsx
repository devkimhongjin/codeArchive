// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ me: vi.fn(), bridge: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./HistoricalImportView', async () => {
  const { useState } = await import('react')
  return { HistoricalImportView: () => { const [count, setCount] = useState(0); return <div>로컬 과거 풀이 동기화<button onClick={() => setCount(value => value + 1)}>검증 작업 {count}</button></div> } }
})

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('keeps local historical sync on the solutions page and removes the historical navigation route', async () => {
  mocks.me.mockRejectedValue(new Error('signed out'))
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '과거 풀이 일괄 동기화 / GitHub 커밋' }))
  expect(await screen.findByText('로컬 과거 풀이 동기화')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '검증 작업 0' }))
  fireEvent.click(screen.getByRole('button', { name: '과거 풀이 관리 닫기' }))
  fireEvent.click(screen.getByRole('button', { name: '과거 풀이 일괄 동기화 / GitHub 커밋' }))
  expect(screen.getByRole('button', { name: '검증 작업 1' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '연동 가이드' }))
  expect(screen.queryByRole('button', { name: '검증 작업 1' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /전체 풀이/ }))
  expect(screen.getByRole('button', { name: '검증 작업 1' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /과거 풀이 가져오기/ })).toBeNull()
  window.history.replaceState({}, '', '/?view=history')
  expect(screen.getByRole('button', { name: /전체 풀이/ })).toBeTruthy()
})
