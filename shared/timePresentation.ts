/** User-facing time is always Korea time; persisted ISO instants stay unchanged. */
export const DISPLAY_TIME_ZONE = 'Asia/Seoul'

function parsedDate(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatKstTimestamp(value?: string | null): string | null {
  const date = parsedDate(value)
  if (!date) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}

export function formatKstTimeToken(value?: string | null): string {
  const timestamp = formatKstTimestamp(value)
  return timestamp ? timestamp.slice(2).replace(/[- :]/g, '') : 'unknown-time'
}

export function formatKstDateTime(value?: string | null, missing = '정보 없음'): string {
  const timestamp = formatKstTimestamp(value)
  return timestamp ? `${timestamp.slice(0, 16)} KST` : missing
}

export function formatKstDate(value?: string | null, missing = '기록 없음', short = false): string {
  const date = parsedDate(value)
  if (!date) return missing
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: DISPLAY_TIME_ZONE, ...(short ? {} : { year: 'numeric' }), month: short ? 'short' : 'numeric', day: 'numeric',
  }).format(date)
}
