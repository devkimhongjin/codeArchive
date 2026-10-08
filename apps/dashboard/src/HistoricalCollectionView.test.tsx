// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HistoricalCollectionView } from './HistoricalCollectionView'

vi.mock('./extensionEnvironment', () => ({ extensionRuntime: () => ({ id: 'fixture-extension' }) }))
afterEach(cleanup)
it('accepts completion only from its own iframe and preserves it across bridge refreshes', () => {
  const receive = vi.fn()
  const props = { extensionId: 'fixture-extension', capability: 'one', supported: true, onSelectionChange: receive }
  const { rerender } = render(<HistoricalCollectionView {...props} />)
  const frame = screen.getByTitle('과거 풀이 수집 화면') as HTMLIFrameElement
  const scope = { batchId: 'SWEA:123', platform: 'SWEA', submissionIds: ['selected'] }
  const data = { type: 'CODEARCHIVE_HISTORY_COLLECTION', scope }
  const emit = (source: Window | null, origin: string, value = data) => fireEvent(window, new MessageEvent('message', { source, origin, data: value }))
  const before = receive.mock.calls.length
  emit(window, window.location.origin); emit(frame.contentWindow, 'https://other.test')
  emit(frame.contentWindow, window.location.origin, { ...data, scope: { ...scope, submissionIds: ['x', 'x'] } })
  expect(receive).toHaveBeenCalledTimes(before)
  emit(frame.contentWindow, window.location.origin)
  expect(receive).toHaveBeenLastCalledWith(scope)
  rerender(<HistoricalCollectionView {...props} capability="two" disabled />)
  expect(screen.getByTitle('과거 풀이 수집 화면')).toBe(frame)
  expect(receive).toHaveBeenLastCalledWith(scope)
  expect(frame.hasAttribute('inert')).toBe(true)
})

it('requests a snapshot on frame readiness and after a late listener subscribes', () => {
  const receive = vi.fn(), props = { extensionId: 'fixture-extension', capability: 'one', supported: true, onSelectionChange: receive }
  const { rerender } = render(<HistoricalCollectionView {...props} />)
  const frame = screen.getByTitle('과거 풀이 수집 화면') as HTMLIFrameElement
  const scope = { batchId: 'SWEA:123', platform: 'SWEA', submissionIds: ['selected'] }
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: window.location.origin, data: { type: 'CODEARCHIVE_HISTORY_COLLECTION', scope } }))
  })
  fireEvent.load(frame)
  expect(post).toHaveBeenLastCalledWith({ type: 'CODEARCHIVE_HISTORY_COLLECTION_REQUEST' }, window.location.origin)
  expect(receive).toHaveBeenLastCalledWith(scope)
  const late = vi.fn()
  rerender(<HistoricalCollectionView {...props} onSelectionChange={late} />)
  expect(late).toHaveBeenLastCalledWith(scope)
  post.mockRestore()
})
