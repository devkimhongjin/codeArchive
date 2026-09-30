// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ me: vi.fn(), bridge: vi.fn(), mounts: 0, unmounts: 0 }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./HistoricalImportView', async () => {
  const React = await import('react')
  return { HistoricalImportView: ({ onActivityChange }: { onActivityChange: (label: string | null) => void }) => {
    React.useEffect(() => {
      mocks.mounts++
      onActivityChange('진행 1/2')
      return () => { mocks.unmounts++ }
    }, [onActivityChange])
    return <div>가져오기 작업 유지</div>
  } }
})

afterEach(() => {
  cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks()
  mocks.mounts = 0; mocks.unmounts = 0
})

it('keeps the historical job mounted and visible in navigation while switching dashboard views', async () => {
  mocks.me.mockRejectedValue(new Error('signed out'))
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  const history = await screen.findByRole('button', { name: /과거 풀이 가져오기 진행 1\/2/ })
  fireEvent.click(history)
  expect(screen.getByText('가져오기 작업 유지')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /전체 풀이/ }))
  expect(mocks.mounts).toBe(1)
  expect(mocks.unmounts).toBe(0)
  expect(history.textContent).toContain('진행 1/2')
  fireEvent.click(history)
  expect(screen.getByText('가져오기 작업 유지')).toBeTruthy()
})
