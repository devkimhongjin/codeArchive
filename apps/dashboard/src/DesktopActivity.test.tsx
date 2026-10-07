// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { monitorDesktopActivity, useDesktopWork } from './DesktopActivity'
import type { DesktopApi } from './desktop'
const desktopWindow = window as Window & { codeArchiveDesktop?: DesktopApi }
afterEach(() => { cleanup(); delete desktopWindow.codeArchiveDesktop; vi.restoreAllMocks() })
it('tracks jobs until completion and releases them on navigation unmount', () => {
  const report = vi.fn().mockResolvedValue(undefined)
  desktopWindow.codeArchiveDesktop = { reportActivity: report } as unknown as DesktopApi
  function Job({ busy }: { busy: boolean }) { useDesktopWork(busy); return <div /> }
  const { rerender, unmount } = render(<Job busy />)
  expect(report).toHaveBeenLastCalledWith({ busy: true, draft: false })
  rerender(<Job busy={false} />); expect(report).toHaveBeenLastCalledWith({ busy: false, draft: false })
  rerender(<Job busy />); unmount(); expect(report).toHaveBeenLastCalledWith({ busy: false, draft: false })
})
it('automatic-update checkbox does not mark a draft, but text and selection changes do', () => {
  const report = vi.fn().mockResolvedValue(undefined)
  desktopWindow.codeArchiveDesktop = { reportActivity: report } as unknown as DesktopApi
  const stop = monitorDesktopActivity()
  try {
    render(<><input aria-label="auto" type="checkbox" /><select aria-label="branch"><option>develop</option><option>master</option></select><textarea aria-label="code" /></>)
    fireEvent.input(screen.getByLabelText('auto')); expect(report).toHaveBeenLastCalledWith({ busy: false, draft: false })
    fireEvent.input(screen.getByLabelText('branch'), { target: { value: 'master' } }); expect(report).toHaveBeenLastCalledWith({ busy: false, draft: true })
    fireEvent.input(screen.getByLabelText('code'), { target: { value: 'user code' } }); expect(report).toHaveBeenLastCalledWith({ busy: false, draft: true })
  } finally { stop() }
})
