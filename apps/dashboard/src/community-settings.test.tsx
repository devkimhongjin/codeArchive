// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CommunitySettings } from './CommunitySettings'
import { ApiError } from './api'
import type { User } from './types'
const mocks = vi.hoisted(() => ({ publish: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), publishAllCommunitySolutions: mocks.publish }))
const user: User = { id: 1, githubId: '100', githubLogin: 'me' }
const props = { user, ready: true, publicByDefault: true, onChange: vi.fn(), onSave: vi.fn(), saving: false, onPublished: vi.fn(), onAuthInvalid: vi.fn() }
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.publish.mockResolvedValue({ changedSubmissions: 3, publishedProblems: 2, publishedSubmissions: 4 }) })
function Harness() {
  const [value, setValue] = useState(true)
  return <CommunitySettings {...props} publicByDefault={value} onChange={setValue} />
}
it('starts public and allows private choice before explicitly saving', () => {
  render(<Harness />)
  expect((screen.getByLabelText('새 정답 풀이의 기본 공개') as HTMLSelectElement).value).toBe('published')
  fireEvent.change(screen.getByLabelText('새 정답 풀이의 기본 공개'), { target: { value: 'private' } })
  expect((screen.getByLabelText('새 정답 풀이의 기본 공개') as HTMLSelectElement).value).toBe('private')
  expect(props.onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '공개 설정 저장' }))
  expect(props.onSave).toHaveBeenCalledOnce()
  expect(mocks.publish).not.toHaveBeenCalled()
})
it('does not enable writes before account settings are ready', () => {
  render(<CommunitySettings {...props} ready={false} />)
  expect((screen.getByRole('button', { name: '기존 정답 풀이 공개' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('새 정답 풀이의 기본 공개') as HTMLSelectElement).disabled).toBe(true)
})
it('publishes only after confirmation and distinguishes problems from submissions', async () => {
  render(<CommunitySettings {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '기존 정답 풀이 공개' }))
  expect(screen.getByRole('dialog', { name: '기존 풀이 일괄 공개 확인' }).textContent).toContain('코드와 닉네임')
  expect(mocks.publish).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '내 정답 풀이 공개 확인' }))
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith('100'))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', '공개 완료 · 문제 2건 · 제출 4건 · 새로 공개 3건')
  expect(props.onPublished).toHaveBeenCalledWith('100')
  expect(props.onSave).not.toHaveBeenCalled()
})
it('cancels confirmation without publishing', () => {
  render(<CommunitySettings {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '기존 정답 풀이 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(mocks.publish).not.toHaveBeenCalled()
})
it('ignores success belonging to the previous account', async () => {
  let resolve!: (value: unknown) => void
  mocks.publish.mockReturnValue(new Promise(done => { resolve = done }))
  const view = render(<CommunitySettings {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '기존 정답 풀이 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '내 정답 풀이 공개 확인' }))
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce())
  view.rerender(<CommunitySettings {...props} user={{ id: 2, githubId: '200', githubLogin: 'other' }} />)
  resolve({ changedSubmissions: 3, publishedProblems: 2, publishedSubmissions: 4 })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(props.onPublished).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})
it('invalidates an expired account and reports uncertain completion without retry', async () => {
  mocks.publish.mockRejectedValue(new ApiError('Authentication is required', 401))
  render(<CommunitySettings {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '기존 정답 풀이 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '내 정답 풀이 공개 확인' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '일괄 공개를 완료하지 못했습니다. 새로고침 후 공개 상태를 확인해 주세요.')
  expect(props.onAuthInvalid).toHaveBeenCalledWith('100')
  expect(props.onPublished).not.toHaveBeenCalled()
  expect(mocks.publish).toHaveBeenCalledOnce()
})

it('exposes all duplicate publication choices and explains immediate existing-record changes', () => {
  const changed = vi.fn()
  render(<CommunitySettings {...props} duplicateVisibility="all" onDuplicateChange={changed} />)
  const select = screen.getByLabelText('중복 제출 공개 설정')
  for (const value of ['execution', 'memory', 'length', 'all']) {
    fireEvent.change(select, { target: { value } })
    expect(changed).toHaveBeenLastCalledWith(value)
  }
  expect(screen.getByText(/기존 정답 풀이에도 즉시 적용/)).toBeTruthy()
  expect(props.onSave).not.toHaveBeenCalled()
})
