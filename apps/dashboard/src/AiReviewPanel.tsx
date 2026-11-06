import { useEffect, useRef, useState } from 'react'
import { ApiError, getAiReview, getAiStatus, grantAiConsent, requestAiReview, revokeAiConsent } from './api'
import type { AiReview, AiStatus, User } from './types'

const FAILURES: Record<string, string> = {
  AI_DISABLED: 'AI 리뷰가 지금은 꺼져 있어요.',
  CONSENT_REQUIRED: '먼저 안내를 확인하고 동의해 주세요.',
  AI_NOTICE_CHANGED: '안내 내용이 바뀌었어요. 다시 확인해 주세요.',
  NOT_FOUND: '이 풀이를 서버에서 찾지 못했어요.',
  DAILY_LIMIT_REACHED: '오늘 요청 한도를 모두 썼어요. 내일 다시 시도해 주세요.',
  SAFETY_BLOCKED: 'AI 공급자가 이 요청에 답하지 않았어요.',
  PROVIDER_TIMEOUT: 'AI 응답이 늦어 멈췄어요. 이 요청도 오늘 사용 횟수에 포함돼요.',
  PROVIDER_FAILED: 'AI 분석에 실패했어요. 잠시 후 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
}

function failureMessage(error: unknown, status: AiStatus | null) {
  const code = error instanceof ApiError ? error.message : ''
  if (code === 'SOURCE_TOO_LARGE') return `코드가 너무 길어 보낼 수 없어요(최대 ${status?.maxSourceBytes ?? 0}바이트).`
  return FAILURES[code] ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

/**
 * AI code review of the selected solution (#251). Nothing renders unless the
 * server reports the feature enabled, and no code is sent before the user
 * agrees to the notice below.
 */
export function AiReviewPanel({ user, captureId }: { user: User; captureId: string }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [review, setReview] = useState<AiReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const currentCapture = useRef(captureId); currentCapture.current = captureId

  useEffect(() => {
    let active = true
    setStatus(null)
    getAiStatus(user.githubId).then(next => { if (active) setStatus(next) }).catch(() => { if (active) setStatus(null) })
    return () => { active = false }
  }, [user.githubId])

  const ready = Boolean(status?.enabled && status.consentGranted)
  useEffect(() => {
    let active = true
    setReview(null); setMessage(null)
    if (!ready) return
    getAiReview(user.githubId, captureId).then(stored => { if (active) setReview(stored) }).catch(() => undefined)
    return () => { active = false }
  }, [ready, user.githubId, captureId])

  if (!status?.enabled) return null
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMessage(null)
    try { await work() }
    catch (error) { setMessage(failureMessage(error, status)) }
    finally {
      setBusy(false)
      void getAiStatus(user.githubId).then(setStatus).catch(() => undefined)
    }
  }
  const consent = () => run(async () => { setStatus(await grantAiConsent(user.githubId, status.noticeVersion)) })
  const revoke = () => run(async () => { setStatus(await revokeAiConsent(user.githubId)); setReview(null) })
  const request = () => run(async () => {
    const requestedFor = captureId
    const result = await requestAiReview(user.githubId, requestedFor)
    if (currentCapture.current === requestedFor) setReview(result)
  })
  const limitReached = status.usedToday >= status.dailyLimit

  return (
    <section className="ai-review" aria-label="AI 코드 리뷰">
      <div className="ai-review-heading">
        <h3>AI 코드 리뷰 <span className="ai-review-badge">미리보기</span></h3>
        <span className="ai-review-usage">오늘 {status.usedToday}/{status.dailyLimit}회</span>
      </div>
      {!status.consentGranted ? (
        <div className="ai-review-notice">
          <p>요청하면 이 풀이의 다음 정보가 AI 공급자({status.provider} · {status.model})로 전송됩니다.</p>
          <ul>
            <li>플랫폼, 문제 번호와 제목, 언어, 실행 시간과 메모리</li>
            <li>소스 코드 전체</li>
          </ul>
          <p>GitHub 아이디, 이름, 이메일 같은 계정 정보는 보내지 않습니다. 결과는 계정에 저장되고, 동의를 철회하면 함께 삭제됩니다. 무료 요금제의 AI 공급자는 받은 입력을 모델 개선에 쓸 수 있습니다.</p>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => void consent()}>안내를 확인했고 동의합니다</button>
        </div>
      ) : (
        <>
          {review ? (
            <div className="ai-review-result">
              <p>{review.summary}</p>
              {review.suggestions.length > 0 && <ol>{review.suggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ol>}
              <small>{review.model} · {review.promptVersion} · {new Date(review.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}{review.cached ? ' · 저장된 결과' : ''}</small>
              <p className="ai-review-disclaimer">AI 제안은 틀릴 수 있어요. 코드는 바뀌지 않습니다.</p>
            </div>
          ) : (
            <button type="button" className="ghost-button" disabled={busy || limitReached} onClick={() => void request()}>{busy ? '분석 중…' : limitReached ? '오늘 한도를 모두 썼어요' : 'AI 리뷰 요청'}</button>
          )}
          <button type="button" className="ai-review-revoke" disabled={busy} onClick={() => void revoke()}>동의 철회</button>
        </>
      )}
      {message && <p role="status" className="ai-review-message">{message}</p>}
    </section>
  )
}
