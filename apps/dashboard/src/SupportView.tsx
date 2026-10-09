import { useEffect, useRef, useState } from 'react'
import { ApiError, createSupportTicket, getMe, getSupportAccess, getSupportAdminTicket, getSupportAdminTickets, getSupportTicket, getSupportTickets, replySupportAdminTicket, setSupportAdminStatus } from './api'
import type { User } from './types'
import type { SupportAccess, SupportCategory, SupportInquiry, SupportPage, SupportStatus } from './supportTypes'

const categories: Array<[SupportCategory, string]> = [['BUG', '오류 제보'], ['QUESTION', '문의'], ['DATA_REQUEST', '데이터 요청']]
const statuses = { OPEN: '접수됨', IN_REVIEW: '확인중', ANSWERED: '답변완료' } as const
const labels = Object.fromEntries(categories) as Record<SupportCategory, string>
const date = (v: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(v))
// Compatibility with the older API during a staged rollout; never offer CLOSED as an action.
const statusLabel = (v: string) => v === 'CLOSED' ? '접수됨' : statuses[v as SupportStatus] ?? '접수됨'
const answerOf = (ticket: SupportInquiry) => { const answers = ticket.messages.filter(message => message.authorRole === 'ADMIN'); return answers[answers.length - 1]?.body ?? '' }

export function SupportView({ user, mode, onLogin, onAuthInvalid }: { user: User | null; mode: 'live' | 'local'; onLogin: () => void; onAuthInvalid: () => void }) {
  const [access, setAccess] = useState<SupportAccess | null>(null), [loadedContext, setLoadedContext] = useState('')
  const [list, setList] = useState<SupportPage | null>(null), [index, setIndex] = useState(0), [selected, setSelected] = useState<SupportInquiry | null>(null)
  const [category, setCategory] = useState<SupportCategory>('BUG'), [title, setTitle] = useState(''), [body, setBody] = useState(''), [answer, setAnswer] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0), context = `${user?.githubId ?? ''}:${mode}`, current = useRef(context)
  if (current.current !== context) { current.current = context; generation.current++ }
  const verified = loadedContext === context && access !== null
  const admin = verified && access.admin
  const active = (g: number, key: string) => generation.current === g && current.current === key
  const clearPrivate = () => { setAccess(null); setLoadedContext(''); setList(null); setSelected(null); setAnswer(''); setTitle(''); setBody('') }
  const authFailure = (cause: unknown, g: number, key: string) => {
    if (!active(g, key) || !(cause instanceof ApiError) || (cause.status !== 401 && cause.status !== 409)) return false
    clearPrivate(); onAuthInvalid(); return true
  }
  const load = async (next = index, detail?: number) => {
    if (!user || mode !== 'live') return
    const key = current.current, g = ++generation.current; setError('')
    try {
      const permitted = await getSupportAccess(user.githubId)
      if (!active(g, key)) return
      const data = permitted.admin ? await getSupportAdminTickets(user.githubId, next) : await getSupportTickets(user.githubId, next)
      if (!active(g, key)) return
      setAccess(permitted); setLoadedContext(key); setList(data); setIndex(data.page)
      if (detail) {
        const ticket = permitted.admin ? await getSupportAdminTicket(user.githubId, detail) : await getSupportTicket(user.githubId, detail)
        if (active(g, key)) { setSelected(ticket); setAnswer(answerOf(ticket)) }
      }
    } catch (cause) { if (!authFailure(cause, g, key) && active(g, key)) setError(cause instanceof Error ? cause.message : '문의를 불러오지 못했습니다.') }
  }
  useEffect(() => {
    clearPrivate(); setIndex(0); setBusy(false); setError('')
    if (user && mode === 'live') void load(0)
    return () => { generation.current++ }
  }, [user?.githubId, mode])
  const check = async (key: string, g: number) => {
    try {
      const me = await getMe()
      if (!active(g, key)) return false
      if (me.githubId !== user?.githubId) { clearPrivate(); onAuthInvalid(); return false }
      return true
    } catch (cause) { if (authFailure(cause, g, key) || !active(g, key)) return false; throw cause }
  }
  const create = async () => {
    if (!user || busy || !verified || admin) return
    if (!title.trim() || !body.trim() || title.length > 150 || body.length > 10000) { setError('제목은 150자, 내용은 10,000자 이내로 입력해 주세요.'); return }
    const key = current.current, g = generation.current; setBusy(true)
    try {
      if (!await check(key, g)) return
      const value = await createSupportTicket(user.githubId, { category, title: title.trim(), body: body.trim() })
      if (!active(g, key)) return
      setTitle(''); setBody(''); setSelected(value); await load(0)
    } catch (e) { if (!authFailure(e, g, key) && active(g, key)) setError(e instanceof Error ? e.message : '문의 등록에 실패했습니다.') }
    finally { if (current.current === key) setBusy(false) }
  }
  const update = async (status?: SupportStatus) => {
    if (!user || !selected || busy || !admin || (!status && (!answer.trim() || answer.length > 10000))) return
    const key = current.current, g = generation.current, id = selected.inquiry.id; setBusy(true)
    try {
      if (!await check(key, g)) return
      const value = status ? await setSupportAdminStatus(user.githubId, id, status) : await replySupportAdminTicket(user.githubId, id, answer.trim())
      if (!active(g, key)) return
      setSelected(value); setAnswer(answerOf(value)); await load(index, id)
    } catch (e) { if (!authFailure(e, g, key) && active(g, key)) setError(e instanceof Error ? e.message : '문의 처리에 실패했습니다.') }
    finally { if (current.current === key) setBusy(false) }
  }
  if (!user || mode !== 'live') return <section className="support-view"><h1>문의·오류 제보</h1><p>개인 문의는 GitHub 로그인 후 서버 연결 상태에서 이용할 수 있습니다.</p><button className="primary-button" onClick={onLogin}>GitHub로 로그인</button></section>
  return <section className="support-view">
    <div className="page-heading"><h1>문의·오류 제보</h1><p>첨부 파일과 자동 수집은 하지 않습니다. 비밀번호, 토큰, 비공개 소스는 입력하지 마세요.</p><p>문의는 본인과 관리자만 열람하며 접수됨·확인중·답변완료 상태로 처리합니다. 임의 종료나 자동 삭제는 하지 않습니다. 데이터 요청은 관리자가 검토합니다. <a href="https://github.com/devkimhongjin/codeArchive/blob/master/docs/extension-privacy.md" target="_blank" rel="noreferrer">개인정보 안내</a></p></div>
    {error && <p role="alert">{error}</p>}
    {!verified ? <p role="status">문의 접근 권한을 확인하고 있습니다.</p> : <div className="support-grid">
      <article><div><h2>{admin ? '전체 문의' : '내 문의'}</h2>
        {!admin && <button type="button" disabled={busy} onClick={() => { generation.current++; setSelected(null); setAnswer('') }}>새 문의</button>}
        <button type="button" disabled={busy} onClick={() => void load(index, selected?.inquiry.id)}>새로고침</button></div>
        {list?.items.map(item => <button type="button" disabled={busy} className="support-ticket" key={item.id} onClick={() => { setSelected(null); setAnswer(''); void load(index, item.id) }}><strong>{item.title}</strong><span>{labels[item.category]} · {statusLabel(item.status)} · {date(item.updatedAt)}</span></button>)}
        {list && !list.items.length && <p>등록된 문의가 없습니다.</p>}
        <div><button type="button" disabled={busy || index === 0} onClick={() => { setSelected(null); void load(index - 1) }}>이전</button><span>{index + 1}</span><button type="button" disabled={busy || !list?.hasMore} onClick={() => { setSelected(null); void load(index + 1) }}>다음</button></div>
      </article>
      <article>{selected ? <>
        <h2>{selected.inquiry.title}</h2><p>{labels[selected.inquiry.category]} · {statusLabel(selected.inquiry.status)}</p>
        <h3>접수 내용</h3><div className="support-messages">{selected.messages.filter(message => message.authorRole === 'USER').map(message => <div key={message.id}><time>{date(message.createdAt)}</time><p>{message.body}</p></div>)}</div>
        {admin ? <><label>처리 상태<select disabled={busy} value={selected.inquiry.status === 'CLOSED' ? 'OPEN' : selected.inquiry.status} onChange={e => void update(e.target.value as SupportStatus)}>{Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>관리자 답변<textarea value={answer} maxLength={10000} disabled={busy} onChange={e => setAnswer(e.target.value)} /></label><button className="primary-button" disabled={busy || !answer.trim()} onClick={() => void update()}>답변 저장</button></> : <><h3>관리자 답변</h3><p>{answerOf(selected) || '아직 등록된 답변이 없습니다.'}</p></>}
      </> : admin ? <p>목록에서 문의를 선택해 상태와 답변을 확인하세요.</p> : <>
        <h2>새 문의</h2><label>분류<select value={category} disabled={busy} onChange={e => setCategory(e.target.value as SupportCategory)}>{categories.map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label>
        <label>제목<input value={title} maxLength={150} disabled={busy} onChange={e => setTitle(e.target.value)} /></label><label>내용<textarea value={body} maxLength={10000} disabled={busy} onChange={e => setBody(e.target.value)} /></label><button className="primary-button" disabled={busy} onClick={() => void create()}>문의 등록</button>
      </>}</article>
    </div>}
  </section>
}
