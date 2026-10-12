export type HistoryServerPlatform = 'JUNGOL' | 'SWEA' | 'PROGRAMMERS'
export type HistoryServerRequest = {
  type: 'CODEARCHIVE_HISTORY_SERVER_REQUEST'; requestId: string; operation: 'IDS'
  platform: HistoryServerPlatform
}
export type HistoryServerResult = { account: string; submissionIds: string[]; created?: boolean }
export function isHistoryServerRequest(value: unknown): value is HistoryServerRequest {
  if (!value || typeof value !== 'object') return false
  const item = value as HistoryServerRequest
  return item.type === 'CODEARCHIVE_HISTORY_SERVER_REQUEST' && typeof item.requestId === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(item.requestId) && ['JUNGOL', 'SWEA', 'PROGRAMMERS'].includes(item.platform) &&
    item.operation === 'IDS'
}
