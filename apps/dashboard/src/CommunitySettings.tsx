import { useEffect, useRef, useState } from 'react'
import { ApiError, publishAllCommunitySolutions } from './api'
import type { User } from './types'

export function CommunitySettings({ user, ready, publicByDefault, onChange, onSave, saving, onPublished, onAuthInvalid }: {
  user: User | null; ready: boolean; publicByDefault: boolean; onChange: (value: boolean) => void
  onSave: () => void; saving: boolean; onPublished: (githubId: string) => void; onAuthInvalid: (githubId: string) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const currentAccount = useRef(user?.githubId)
  currentAccount.current = user?.githubId
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setConfirm(false); setBusy(false); setMessage(null); setError(null) }, [user?.githubId])
  const publish = async () => {
    if (!user || !ready || busy || !confirm) return
    const githubId = user.githubId
    const current = () => mounted.current && currentAccount.current === githubId
    setBusy(true); setError(null); setMessage(null)
    try {
      const result = await publishAllCommunitySolutions(githubId)
      if (!current()) return
      setConfirm(false)
      setMessage(`공개 완료 · 문제 ${result.publishedProblems}건 · 제출 ${result.publishedSubmissions}건 · 새로 공개 ${result.changedSubmissions}건`)
      onPublished(githubId)
    } catch (cause) {
      if (!current()) return
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 409)) onAuthInvalid(githubId)
      setError(cause instanceof ApiError && cause.status === 429 ? '잠시 후 다시 시도해 주세요.' : '일괄 공개를 완료하지 못했습니다. 새로고침 후 공개 상태를 확인해 주세요.')
    } finally { if (current()) setBusy(false) }
  }
  return <article className="settings-card community-settings">
    <h2>커뮤니티 공개</h2>
    <div className="setting-field"><label htmlFor="community-default-visibility">새 정답 풀이의 기본 공개</label>
      <select id="community-default-visibility" value={publicByDefault ? 'published' : 'private'} disabled={!ready || saving || busy} onChange={event => onChange(event.target.value === 'published')}>
        <option value="published">공개</option><option value="private">비공개</option>
      </select>
    </div>
    <p>새로 동기화하는 정답 풀이에 적용됩니다. 기존 풀이의 공개 상태는 바뀌지 않습니다.</p>
    <p>공개한 코드와 표시 이름·닉네임은 같은 플랫폼·같은 문제의 풀이를 공개한 로그인 사용자에게 보입니다.</p>
    <button type="button" className="primary-button" disabled={!ready || saving || busy} onClick={onSave}>{saving ? '공개 기본값 저장 중…' : '공개 기본값 저장'}</button>
    {!user && <p>로그인 후 계정의 공개 설정을 저장할 수 있습니다.</p>}
    <h3>기존 문제 공개</h3><p>이 계정에 저장된 기존 정답 풀이를 모두 공개합니다. 비정답 풀이와 다른 계정의 기록은 제외됩니다.</p>
    <button type="button" className="ghost-button" disabled={!ready || busy || saving} onClick={() => { setConfirm(true); setError(null); setMessage(null) }}>기존 정답 풀이 모두 공개</button>
    {confirm && <div className="community-confirm" role="dialog" aria-label="기존 풀이 일괄 공개 확인"><p>내 기존 정답 코드와 표시 이름·닉네임을 커뮤니티에 공개할까요? 각 풀이의 공개는 나중에 취소할 수 있습니다.</p>
      <button type="button" className="ghost-button" disabled={busy} onClick={() => setConfirm(false)}>취소</button>
      <button type="button" className="primary-button" disabled={busy || !ready} onClick={() => void publish()}>{busy ? '공개 중…' : '내 정답 풀이 전체 공개 확인'}</button>
    </div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </article>
}
