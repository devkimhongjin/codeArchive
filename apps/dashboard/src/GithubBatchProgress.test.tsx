// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GithubBatchProgress } from './GithubBatchProgress'

const mocks = vi.hoisted(() => ({ message: vi.fn(), runtime: vi.fn() }))
vi.mock('./extensionEnvironment', () => ({ extensionMessage: mocks.message, extensionRuntime: mocks.runtime }))

const user = { id: 9, githubId: '123', githubLogin: 'account' }
const task = (status: 'REQUESTING' | 'TRACKING' | 'DONE' | 'PAUSED', extra: Record<string, unknown> = {}) => ({
  taskId: 't1', account: '9:123', status, offset: 3, cancelRequested: false, updatedAt: 0,
  captureIds: ['a', 'b', 'c', 'd'], states: { a: 'SUCCEEDED', b: 'FAILED', c: 'UNKNOWN', d: 'NONE' },
  settingsVersion: 1, installationId: 1, owner: 'owner', repository: 'archive', branch: 'main', ...extra,
})

beforeEach(() => { vi.resetAllMocks(); mocks.runtime.mockReturnValue({ id: 'extension' }) })
afterEach(() => cleanup())

it('shows the running batch with its counts and stops further requests on request', async () => {
  mocks.message.mockImplementation(async (message: { type: string }) => ({ task: message.type === 'CANCEL_GITHUB_BATCH' ? task('TRACKING', { cancelRequested: true }) : task('TRACKING') }))
  render(<GithubBatchProgress user={user} showCompleted={false} />)
  expect(await screen.findByText('GitHub 일괄 커밋 진행 중')).toBeTruthy()
  expect(screen.getByText('처리 3/4건 · 서버 접수 3건 · 성공 1건 · 실패 1건 · 확인 필요 1건')).toBeTruthy()
  expect(mocks.message).toHaveBeenCalledWith({ type: 'GET_GITHUB_BATCH', account: '9:123' })
  fireEvent.click(screen.getByRole('button', { name: '추가 요청 중단' }))
  await waitFor(() => expect(mocks.message).toHaveBeenCalledWith({ type: 'CANCEL_GITHUB_BATCH', account: '9:123' }))
  expect(await screen.findByText('추가 요청을 중단했습니다. 이미 접수한 커밋의 결과는 계속 확인합니다.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '추가 요청 중단' })).toBeNull()
})

it('shows a finished batch only where batches are managed', async () => {
  mocks.message.mockResolvedValue({ task: task('DONE') })
  const { rerender } = render(<GithubBatchProgress user={user} showCompleted={false} />)
  await waitFor(() => expect(mocks.message).toHaveBeenCalled())
  expect(screen.queryByLabelText('백그라운드 일괄 커밋 진행 상황')).toBeNull()
  rerender(<GithubBatchProgress user={user} showCompleted />)
  expect(await screen.findByText('GitHub 일괄 커밋 처리 완료')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('ignores another account and stays hidden outside the extension', async () => {
  mocks.message.mockResolvedValue({ task: { ...task('TRACKING'), account: '8:456' } })
  render(<GithubBatchProgress user={user} showCompleted />)
  await waitFor(() => expect(mocks.message).toHaveBeenCalled())
  expect(screen.queryByLabelText('백그라운드 일괄 커밋 진행 상황')).toBeNull()
  cleanup(); mocks.message.mockClear(); mocks.runtime.mockReturnValue(undefined)
  render(<GithubBatchProgress user={user} showCompleted />)
  expect(mocks.message).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('백그라운드 일괄 커밋 진행 상황')).toBeNull()
})
