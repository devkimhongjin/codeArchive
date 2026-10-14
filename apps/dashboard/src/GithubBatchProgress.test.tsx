// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GithubBatchProgress } from './GithubBatchProgress'
import type { GithubBatchTask } from '../../extension/src/githubBatchTask'
const { message } = vi.hoisted(() => ({ message: vi.fn() }))
vi.mock('./extensionEnvironment', () => ({ extensionRuntime: () => ({}), extensionMessage: message }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const active = { account: '1:123', status: 'TRACKING', owner: 'synthetic', repository: 'fixture', branch: 'main', captureIds: ['one'], offset: 1, states: { one: 'PENDING' }, cancelRequested: false } as unknown as GithubBatchTask
it('automatically removes the dashboard progress after a completed task response', async () => {
  message.mockResolvedValueOnce({ task: active }).mockResolvedValue({ task: { ...active, status: 'DONE', states: { one: 'SUCCEEDED' } } })
  render(<GithubBatchProgress user={{ id:1,githubId:'123',githubLogin:'synthetic' }} />)
  await screen.findByRole('region', { name: '백그라운드 일괄 커밋 진행 상황' })
  await act(async () => { window.dispatchEvent(new Event('codearchive-github-batch-started')) })
  await waitFor(() => expect(screen.queryByRole('region', { name: '백그라운드 일괄 커밋 진행 상황' })).toBeNull())
  expect(message).toHaveBeenCalledTimes(2)
})
it('keeps paused work actionable but does not restore a completed task on remount', async () => {
  message.mockResolvedValue({ task: { ...active, status:'PAUSED' } })
  const view=render(<GithubBatchProgress user={{id:1,githubId:'123',githubLogin:'synthetic'}} />)
  await screen.findByRole('button', { name:'작업 이어가기' })
  view.unmount();message.mockResolvedValue({task:{...active,status:'DONE',states:{one:'UNKNOWN'}}})
  render(<GithubBatchProgress user={{id:1,githubId:'123',githubLogin:'synthetic'}} />)
  await waitFor(()=>expect(message).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('region', {name:'백그라운드 일괄 커밋 진행 상황'})).toBeNull()
})
