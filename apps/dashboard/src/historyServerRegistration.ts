import { getHistoricalSubmissionIds, getMe } from './api'
import type { User } from './types'
import type { HistoryServerRequest, HistoryServerResult } from '../../../shared/historyServerProtocol'

export type HistoryServerContext = { user: User | null; mode: 'live' | 'local'; extensionId: string; capability: string | null }
export const historyAccountKey = (user: User) => `${user.id}:${user.githubId}`

/** Read-only account-bound server membership for candidate selection and receipts. */
export async function handleHistoryServerRequest(request: HistoryServerRequest, context: () => HistoryServerContext): Promise<HistoryServerResult> {
  const initial = context()
  if (!initial.user || initial.mode !== 'live') throw new Error('CodeArchive에 로그인한 뒤 수집을 시작해 주세요.')
  const account = historyAccountKey(initial.user)
  const assertCurrent = () => {
    const current = context()
    if (!current.user || current.mode !== 'live' || historyAccountKey(current.user) !== account || current.extensionId !== initial.extensionId)
      throw new Error('로그인 계정이 변경되었습니다. 새 계정에서 후보 찾기를 다시 실행해 주세요.')
  }
  const confirm = async () => {
    assertCurrent()
    const user = await getMe()
    assertCurrent()
    if (historyAccountKey(user) !== account) throw new Error('로그인 계정이 변경되었습니다. 후보 찾기를 다시 실행해 주세요.')
  }
  await confirm()
  const ids = await getHistoricalSubmissionIds(initial.user.githubId, request.platform)
  assertCurrent()
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('서버 제출 기록을 확인하지 못했습니다. 다시 시도해 주세요.')
  return { account, submissionIds: [...new Set(ids)] }
}
