// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CommunityComments } from './CommunityComments'
import { ApiError } from './api'

const mocks = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), edit: vi.fn(), remove: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getCommunityComments: mocks.list,
  addCommunityComment: mocks.add, editCommunityComment: mocks.edit, deleteCommunityComment: mocks.remove }))
const comment = { id: 1, body: '<img src=x onerror=alert(1)>', author: { nickname: '닉' }, mine: true,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const page = { items: [comment, { ...comment, id: 2, mine: false, body: '다른 댓글' }], page: 0, size: 20, total: 2, hasMore: false }
const props = { githubId: '100', solutionId: 44, onCount: vi.fn(), onUnavailable: vi.fn(), onAuthInvalid: vi.fn() }
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue(page); mocks.add.mockResolvedValue({ saved: true }); mocks.edit.mockResolvedValue({ saved: true }); mocks.remove.mockResolvedValue({ saved: true }) })
afterEach(cleanup)

it('renders text safely, KST timestamps, and edit/delete only for own comments', async () => {
  render(<CommunityComments {...props} />)
  expect(await screen.findByText(comment.body)).toBeTruthy()
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getAllByText(/09:00/)).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: '댓글 수정' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '댓글 삭제' })).toHaveLength(1)
})

it('writes, edits, deletes, and reloads the server page without optimistic counts', async () => {
  render(<CommunityComments {...props} />)
  await screen.findByText('다른 댓글')
  fireEvent.change(screen.getByLabelText('댓글 내용'), { target: { value: '새 댓글' } })
  fireEvent.click(screen.getByRole('button', { name: '댓글 등록' }))
  await waitFor(() => expect(mocks.add).toHaveBeenCalledWith('100', 44, '새 댓글'))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '댓글 수정' }))
  fireEvent.change(screen.getByLabelText('댓글 수정 내용'), { target: { value: '수정 내용' } })
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }))
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith('100', 44, 1, '수정 내용'))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))
  fireEvent.click(screen.getByRole('button', { name: '댓글 삭제' }))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('100', 44, 1))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(4))
  expect(props.onCount).toHaveBeenLastCalledWith(2)
})

it('reports failure and allows retry while refusing blank or oversized input', async () => {
  mocks.add.mockRejectedValueOnce(new ApiError('rate', 429))
  render(<CommunityComments {...props} />)
  await screen.findByText('다른 댓글')
  expect((screen.getByRole('button', { name: '댓글 등록' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('댓글 내용'), { target: { value: 'x'.repeat(2001) } })
  expect((screen.getByRole('button', { name: '댓글 등록' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('댓글 내용'), { target: { value: '정상 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '댓글 등록' }))
  expect((await screen.findByRole('alert')).textContent).toContain('1분 뒤')
  expect((screen.getByLabelText('댓글 내용') as HTMLTextAreaElement).value).toBe('정상 의견')
  fireEvent.click(screen.getByRole('button', { name: '댓글 등록' }))
  await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(2))
})

it('clears the parent source when revoked and ignores responses after unmount', async () => {
  mocks.list.mockRejectedValueOnce(new ApiError('hidden', 404))
  const view = render(<CommunityComments {...props} />)
  await waitFor(() => expect(props.onUnavailable).toHaveBeenCalledOnce())
  view.unmount()
  let resolve!: (value: typeof page) => void
  mocks.list.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const pending = render(<CommunityComments {...props} />)
  pending.unmount(); resolve(page)
  await Promise.resolve()
  expect(props.onCount).not.toHaveBeenCalled()
})
