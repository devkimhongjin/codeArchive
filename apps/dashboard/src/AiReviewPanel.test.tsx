// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AiReviewPanel } from './AiReviewPanel'
import { ApiError } from './api'
import type { AiStatus } from './types'

const mocks = vi.hoisted(() => ({ status: vi.fn(), consent: vi.fn(), revoke: vi.fn(), review: vi.fn(), request: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getAiStatus: mocks.status, grantAiConsent: mocks.consent, revokeAiConsent: mocks.revoke, getAiReview: mocks.review, requestAiReview: mocks.request }))

const user = { id: 9, githubId: '123', githubLogin: 'account' }
const status = (patch: Partial<AiStatus> = {}): AiStatus => ({ enabled: true, provider: 'fake', model: 'fake-review-1', dailyLimit: 5, usedToday: 0, consentGranted: false, noticeVersion: '2026-11-06', maxSourceBytes: 20000, ...patch })
const review = { captureId: 'c1', provider: 'fake', model: 'fake-review-1', promptVersion: 'code-review-v1', summary: '요약입니다.', suggestions: ['첫 제안', '둘째 제안'], createdAt: '2026-11-06T01:00:00Z', cached: false }

beforeEach(() => { vi.resetAllMocks(); mocks.review.mockResolvedValue(null) })
afterEach(() => cleanup())

it('renders nothing while the server reports AI review disabled', async () => {
  mocks.status.mockResolvedValue(status({ enabled: false, provider: null, model: null }))
  const { container } = render(<AiReviewPanel user={user} captureId="c1" />)
  await waitFor(() => expect(mocks.status).toHaveBeenCalledWith('123'))
  expect(container.innerHTML).toBe('')
  expect(mocks.review).not.toHaveBeenCalled()
})

it('shows what is sent before consent, then requests and shows a review', async () => {
  mocks.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ consentGranted: true, usedToday: 1 }))
  mocks.consent.mockResolvedValue(status({ consentGranted: true }))
  mocks.request.mockResolvedValue(review)
  render(<AiReviewPanel user={user} captureId="c1" />)
  expect(await screen.findByText('소스 코드 전체')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'AI 리뷰 요청' })).toBeNull()
  expect(mocks.request).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '안내를 확인했고 동의합니다' }))
  await waitFor(() => expect(mocks.consent).toHaveBeenCalledWith('123', '2026-11-06'))
  fireEvent.click(await screen.findByRole('button', { name: 'AI 리뷰 요청' }))
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('123', 'c1'))
  expect(await screen.findByText('요약입니다.')).toBeTruthy()
  expect(screen.getByText('둘째 제안')).toBeTruthy()
  expect(screen.getByText('AI 제안은 틀릴 수 있어요. 코드는 바뀌지 않습니다.')).toBeTruthy()
  expect(await screen.findByText('오늘 1/5회')).toBeTruthy()
})

it('shows a stored review and explains a reached daily limit', async () => {
  mocks.status.mockResolvedValue(status({ consentGranted: true, usedToday: 4 }))
  mocks.review.mockResolvedValueOnce({ ...review, cached: true }).mockResolvedValue(null)
  const { rerender } = render(<AiReviewPanel user={user} captureId="c1" />)
  expect(await screen.findByText('요약입니다.')).toBeTruthy()
  expect(screen.getByText(/저장된 결과/)).toBeTruthy()
  mocks.request.mockRejectedValue(new ApiError('DAILY_LIMIT_REACHED', 429))
  rerender(<AiReviewPanel user={user} captureId="c2" />)
  fireEvent.click(await screen.findByRole('button', { name: 'AI 리뷰 요청' }))
  expect(await screen.findByText('오늘 요청 한도를 모두 썼어요. 내일 다시 시도해 주세요.')).toBeTruthy()
})

it('withdrawing consent hides the review and returns to the notice', async () => {
  mocks.status.mockResolvedValue(status({ consentGranted: true }))
  mocks.review.mockResolvedValue(review)
  mocks.revoke.mockResolvedValue(status())
  render(<AiReviewPanel user={user} captureId="c1" />)
  expect(await screen.findByText('요약입니다.')).toBeTruthy()
  mocks.status.mockResolvedValue(status())
  fireEvent.click(screen.getByRole('button', { name: '동의 철회' }))
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('123'))
  expect(await screen.findByRole('button', { name: '안내를 확인했고 동의합니다' })).toBeTruthy()
  expect(screen.queryByText('요약입니다.')).toBeNull()
})
