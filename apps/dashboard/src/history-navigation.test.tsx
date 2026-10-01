// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ me: vi.fn(), bridge: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./HistoricalImportView', () => ({ HistoricalImportView: () => <div>로컬 과거 풀이 동기화</div> }))

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('keeps local historical sync on the solutions page and removes the historical navigation route', async () => {
  mocks.me.mockRejectedValue(new Error('signed out'))
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '과거 풀이 서버 동기화' }))
  expect(await screen.findByText('로컬 과거 풀이 동기화')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /과거 풀이 가져오기/ })).toBeNull()
  window.history.replaceState({}, '', '/?view=history')
  expect(screen.getByRole('button', { name: /전체 풀이/ })).toBeTruthy()
})
