import { useEffect, useRef, useState } from 'react'
import { ApiError, addCommunityComment, deleteCommunityComment, editCommunityComment, getCommunityComments } from './api'
import type { CommunityCommentPage } from './types'
import { formatKstDateTime } from '../../../shared/timePresentation'

export function CommunityComments({ githubId, solutionId, onCount, onUnavailable, onAuthInvalid }: {
  githubId: string; solutionId: number; onCount: (count: number) => void
  onUnavailable: () => void; onAuthInvalid: (githubId: string) => void
}) {
  const [page, setPage] = useState(0)
  const [data, setData] = useState<CommunityCommentPage | null>(null)
  const [body, setBody] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const mounted = useRef(false)
  const writing = useRef(false)
  const callbacks = useRef({ onCount, onUnavailable, onAuthInvalid })
  callbacks.current = { onCount, onUnavailable, onAuthInvalid }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const failure = (cause: unknown) => {
    if (!mounted.current) return
    if (cause instanceof ApiError) {
      if (cause.status === 401 || (cause.status === 409 && cause.message === 'GitHub account changed; reconnect required')) {
        callbacks.current.onAuthInvalid(githubId); callbacks.current.onUnavailable(); return
      }
      if (cause.status === 404) { callbacks.current.onUnavailable(); return }
    }
    setError(cause instanceof ApiError && cause.status === 429 ? '요청이 많습니다. 1분 뒤 다시 시도해 주세요.' : '댓글 요청을 완료하지 못했습니다. 다시 시도해 주세요.')
  }
  useEffect(() => {
    let active = true
    setLoading(true); setData(null); setError('')
    void getCommunityComments(githubId, solutionId, page).then(result => {
      if (!active) return
      const last = Math.max(0, Math.ceil(result.total / result.size) - 1)
      if (page > last) { setPage(last); return }
      setData(result); callbacks.current.onCount(result.total)
    }).catch(cause => { if (active) failure(cause) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [githubId, solutionId, page, refresh])
  const write = async (action: () => Promise<unknown>) => {
    if (writing.current) return
    writing.current = true; setBusy(true); setError('')
    try {
      await action()
      if (!mounted.current) return
      setBody(''); setEditId(null); setPage(0); setRefresh(value => value + 1)
    } catch (cause) { failure(cause) }
    finally { writing.current = false; if (mounted.current) setBusy(false) }
  }
  const valid = (value: string) => value.trim().length > 0 && value.length <= 2000
  return <section className="community-comments" aria-label="풀이 댓글">
    <h4>댓글 {data?.total ?? ''}</h4>
    {loading && <p role="status">댓글을 불러오는 중…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>댓글 다시 불러오기</button></div>}
    {data?.items.map(comment => <article key={comment.id}>
      <header><strong>{comment.author.nickname || '닉네임 미설정'}{comment.mine && <span className="community-mine">내 댓글</span>}</strong><time>{formatKstDateTime(comment.createdAt)}</time>{comment.updatedAt !== comment.createdAt && <small>수정됨</small>}</header>
      {editId === comment.id ? <form onSubmit={event => { event.preventDefault(); if (valid(editBody)) void write(() => editCommunityComment(githubId, solutionId, comment.id, editBody)) }}>
        <textarea aria-label="댓글 수정 내용" maxLength={2000} value={editBody} disabled={busy} onChange={event => setEditBody(event.target.value)} />
        <button type="submit" disabled={busy || !valid(editBody)}>수정 저장</button><button type="button" disabled={busy} onClick={() => setEditId(null)}>수정 취소</button>
      </form> : <p className="community-comment-body">{comment.body}</p>}
      {comment.mine && editId !== comment.id && <div><button type="button" disabled={busy} onClick={() => { setEditId(comment.id); setEditBody(comment.body) }}>댓글 수정</button><button type="button" disabled={busy} onClick={() => void write(() => deleteCommunityComment(githubId, solutionId, comment.id))}>댓글 삭제</button></div>}
    </article>)}
    {data && data.total === 0 && <p>첫 댓글을 남겨 보세요.</p>}
    {data && data.total > data.size && <div className="community-pages"><span>{page + 1}페이지</span><button type="button" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>이전 댓글</button><button type="button" disabled={busy || !data.hasMore} onClick={() => setPage(value => value + 1)}>다음 댓글</button></div>}
    <form onSubmit={event => { event.preventDefault(); if (valid(body)) void write(() => addCommunityComment(githubId, solutionId, body)) }}>
      <label>댓글 작성<textarea aria-label="댓글 내용" maxLength={2000} value={body} disabled={busy || loading || !data} onChange={event => setBody(event.target.value)} placeholder="이 풀이에 대한 의견을 남겨 주세요." /></label>
      <div><span>{body.length}/2000자</span><button type="submit" className="primary-button" disabled={busy || loading || !data || !valid(body)}>{busy ? '저장 중…' : '댓글 등록'}</button></div>
    </form>
  </section>
}
