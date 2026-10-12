// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { handleHistoryServerRequest } from './historyServerRegistration'
import type { HistoryServerContext } from './historyServerRegistration'
const mocks = vi.hoisted(() => ({ me: vi.fn(), ids: vi.fn() }))
vi.mock('./api', () => ({ getMe: mocks.me, getHistoricalSubmissionIds: mocks.ids }))
const user = { id: 1, githubId: '1', githubLogin: 'account' }
let context: HistoryServerContext
const request = { type: 'CODEARCHIVE_HISTORY_SERVER_REQUEST' as const, requestId: 'id', operation: 'IDS' as const, platform: 'JUNGOL' as const }
beforeEach(() => { vi.resetAllMocks(); context = { user, mode: 'live', capability: 'cap', extensionId: 'extension' }; mocks.me.mockResolvedValue(user); mocks.ids.mockResolvedValue(['101']) })
it('reads only account-qualified server membership and never device solution data', async () => {
  expect(await handleHistoryServerRequest(request, () => context)).toEqual({ account: '1:1', submissionIds: ['101'] })
  expect(mocks.ids).toHaveBeenCalledWith('1', 'JUNGOL')
})
it('requires login before reading server membership', async () => {
  context.user = null
  await expect(handleHistoryServerRequest(request, () => context)).rejects.toThrow('로그인')
  expect(mocks.ids).not.toHaveBeenCalled()
})
it('fences an account switch while server membership is being read', async () => {
  mocks.ids.mockImplementation(async () => { context = { ...context, user: { ...user, id: 2 } }; return [] })
  await expect(handleHistoryServerRequest(request, () => context)).rejects.toThrow('계정이 변경')
})
it('does not treat an invalid server response as an empty duplicate list', async () => {
  mocks.ids.mockResolvedValue(null)
  await expect(handleHistoryServerRequest(request, () => context)).rejects.toThrow('서버 제출 기록')
})
