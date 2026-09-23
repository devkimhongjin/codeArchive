import { useEffect, useMemo, useRef, useState } from 'react'
import { canonicalLanguageDisplayName, canonicalLanguageKey } from '../../../shared/language'
import { ApiError, getCommunityDetail, getCommunitySolutions, setCommunityVisibility } from './api'
import { CodeBlock } from './CodeBlock'
import { formatExecutionTime, formatMemory } from './performancePresentation'
import { groupSolutions } from './solutionQuery'
import type { CommunityDetail, CommunityPage, Platform, Solution, User, AccountSettings } from './types'
import type { CommunityRoute } from './communityRoute'
import './community.css'

type ListState = { key: string; status: 'loading' | 'ready' | 'eligibility' | 'error'; data: CommunityPage | null; message: string }
type DetailState = { key: string; status: 'loading' | 'ready' | 'error'; data: CommunityDetail | null; message: string }

const knownLanguages = ['java', 'kotlin', 'python', 'javascript', 'typescript', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'swift', 'scala', 'sql']
const problemPattern = /^[A-Za-z0-9_-]{1,100}$/
const accountChangedMessage = 'GitHub account changed; reconnect required'
const publishEligibilityMessage = 'Only accepted solutions can be published'

function isAuthInvalid(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || (error.status === 409 && error.message === accountChangedMessage))
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'GitHub 로그인이 필요합니다. 다시 로그인해 주세요.'
    if (error.status === 409 && error.message === accountChangedMessage) return '로그인한 GitHub 계정이 변경됐습니다. 새로 연결해 주세요.'
    if (error.status === 409 && error.message === publishEligibilityMessage) return '통과한 풀이만 공개할 수 있습니다. 풀이 상태를 새로 확인해 주세요.'
    if (error.status === 429) return '요청이 많아 잠시 제한됐습니다. 1분 뒤 다시 시도해 주세요.'
    if (error.status >= 500) return '커뮤니티 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  return fallback
}

export function CommunityView({ user, mode, solutions, route, onRouteChange, onReturnToArchive, onVisibilityChanged, onAuthInvalid, onLogin, lightTheme, darkTheme }: {
  user: User | null
  mode: 'local' | 'live'
  solutions: Solution[]
  route: CommunityRoute
  onRouteChange: (route: CommunityRoute) => void
  onReturnToArchive: (platform: Platform, problemNumber: string) => void
  onVisibilityChanged: (expectedGithubId: string, id: number, visibility: 'private' | 'published', publishedAt: string | null) => void
  onAuthInvalid: (expectedGithubId: string) => void
  onLogin: () => void
  lightTheme: AccountSettings['lightTheme']
  darkTheme: AccountSettings['darkTheme']
}) {
  const [draftPlatform, setDraftPlatform] = useState<Platform>(route.platform)
  const [draftProblem, setDraftProblem] = useState(route.problemNumber)
  const [problemSearch, setProblemSearch] = useState('')
  const [listSearch, setListSearch] = useState('')
  const [listState, setListState] = useState<ListState | null>(null)
  const [detailState, setDetailState] = useState<DetailState | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [visibilityBusy, setVisibilityBusy] = useState(false)
  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  const currentGithubId = useRef(user?.githubId)
  currentGithubId.current = user?.githubId
  const onAuthInvalidRef = useRef(onAuthInvalid)
  onAuthInvalidRef.current = onAuthInvalid
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => { setDraftPlatform(route.platform); setDraftProblem(route.problemNumber); setListSearch(''); setConfirmId(null) }, [route.platform, route.problemNumber])
  useEffect(() => { setConfirmId(null); setVisibilityBusy(false); setVisibilityError(null) }, [user?.githubId, mode])

  const ownGroups = useMemo(() => groupSolutions(solutions), [solutions])
  const matchingGroups = ownGroups.filter(group => group.platform === draftPlatform && (!problemSearch.trim() || `${group.problemNumber} ${group.title}`.toLocaleLowerCase('ko-KR').includes(problemSearch.trim().toLocaleLowerCase('ko-KR'))))
  const ownForProblem = solutions.filter(solution => solution.platform === route.platform && solution.problemNumber === route.problemNumber && typeof solution.id === 'number')
  const languageKeys = Array.from(new Set([...knownLanguages, ...solutions.map(solution => solution.languageKey ?? canonicalLanguageKey(solution.language)), ...(listState?.data?.items ?? []).map(item => item.languageKey)]))
    .filter(key => /^[a-z0-9:._-]{1,100}$/.test(key))
  const listKey = `${user?.githubId ?? ''}:${route.platform}:${route.problemNumber}:${route.languageKey}:${route.page}:${refresh}`
  const detailKey = `${user?.githubId ?? ''}:${route.platform}:${route.problemNumber}:${route.detailId ?? ''}:${refresh}`
  const canBrowse = Boolean(user && mode === 'live')

  useEffect(() => {
    if (!canBrowse || !user || !route.problemNumber) return
    let active = true
    setListState({ key: listKey, status: 'loading', data: null, message: '' })
    void getCommunitySolutions(user.githubId, route.platform, route.problemNumber, route.languageKey, route.page)
      .then(data => { if (active) setListState({ key: listKey, status: 'ready', data, message: '' }) })
      .catch(error => {
        if (!active) return
        if (isAuthInvalid(error)) onAuthInvalidRef.current(user.githubId)
        if (error instanceof ApiError && error.status === 403) setListState({ key: listKey, status: 'eligibility', data: null, message: '이 문제의 내 풀이를 먼저 공개해야 다른 풀이를 볼 수 있습니다.' })
        else setListState({ key: listKey, status: 'error', data: null, message: readError(error, '공개 풀이를 불러오지 못했습니다. 다시 시도해 주세요.') })
      })
    return () => { active = false }
  }, [canBrowse, user?.githubId, route.platform, route.problemNumber, route.languageKey, route.page, refresh, listKey])

  useEffect(() => {
    if (!canBrowse || !user || !route.problemNumber || !route.detailId) return
    let active = true
    setDetailState({ key: detailKey, status: 'loading', data: null, message: '' })
    void getCommunityDetail(user.githubId, route.detailId)
      .then(data => {
        if (!active) return
        if (data.platform !== route.platform || data.problemNumber !== route.problemNumber) setDetailState({ key: detailKey, status: 'error', data: null, message: '이 문제의 풀이를 찾지 못했습니다.' })
        else setDetailState({ key: detailKey, status: 'ready', data, message: '' })
      })
      .catch(error => { if (active) { if (isAuthInvalid(error)) onAuthInvalidRef.current(user.githubId); setDetailState({ key: detailKey, status: 'error', data: null, message: error instanceof ApiError && error.status === 404 ? '풀이가 비공개로 바뀌었거나 더는 볼 수 없습니다.' : readError(error, '풀이를 불러오지 못했습니다.') }) } })
    return () => { active = false }
  }, [canBrowse, user?.githubId, route.platform, route.problemNumber, route.detailId, refresh, detailKey])

  const selectProblem = (platform: Platform, problemNumber: string) => onRouteChange({ platform, problemNumber, languageKey: '', page: 0, detailId: null })
  const searchProblem = () => {
    const number = draftProblem.trim()
    if (problemPattern.test(number)) selectProblem(draftPlatform, number)
  }
  const changeVisibility = async (solution: Solution) => {
    if (!user || mode !== 'live' || typeof solution.id !== 'number' || visibilityBusy) return
    const expectedGithubId = user.githubId
    const visibility = solution.visibility === 'published' ? 'private' : 'published'
    if (visibility === 'published' && solution.result !== 'ACCEPTED') {
      setConfirmId(null)
      setVisibilityError('통과한 풀이만 공개할 수 있습니다.')
      return
    }
    setVisibilityBusy(true); setVisibilityError(null)
    try {
      const result = await setCommunityVisibility(expectedGithubId, solution.id, visibility)
      if (!mounted.current || currentGithubId.current !== expectedGithubId) return
      setListState(null); setDetailState(null)
      onVisibilityChanged(expectedGithubId, solution.id, result.visibility, result.publishedAt)
      setConfirmId(null)
      setRefresh(value => value + 1)
    } catch (error) {
      if (mounted.current && currentGithubId.current === expectedGithubId) {
        if (isAuthInvalid(error)) onAuthInvalidRef.current(expectedGithubId)
        setVisibilityError(readError(error, '공개 설정을 바꾸지 못했습니다. 다시 시도해 주세요.'))
      }
    } finally { if (mounted.current && currentGithubId.current === expectedGithubId) setVisibilityBusy(false) }
  }

  const currentList = listState?.key === listKey ? listState : null
  const currentDetail = detailState?.key === detailKey ? detailState : null
  const visibleSummaries = (currentList?.data?.items ?? []).filter(item => !listSearch.trim() || `${item.title} ${item.language} ${item.author.name} ${item.author.nickname ?? ''}`.toLocaleLowerCase('ko-KR').includes(listSearch.trim().toLocaleLowerCase('ko-KR')))
  const candidate = ownForProblem.find(item => item.id === confirmId)

  return <section className="community-page" aria-label="커뮤니티">
    <div className="community-heading"><div><p className="eyebrow"><span className="eyebrow-dot" /> COMMUNITY / SOLUTIONS</p><h1>커뮤니티</h1><p>같은 문제를 푼 사람들의 공개 풀이를 살펴보세요. 내 풀이 공개는 직접 선택할 때만 진행됩니다.</p></div></div>
    {!user && <div className="community-notice"><strong>GitHub 로그인이 필요합니다</strong><p>로그인 후 내 풀이를 동기화하면 같은 문제의 공개 풀이를 찾을 수 있습니다.</p><button type="button" className="primary-button" onClick={onLogin}>GitHub로 로그인</button></div>}
    {user && mode !== 'live' && <div className="community-notice"><strong>서버 아카이브 연결이 필요합니다</strong><p>현재 로컬 기록만 표시 중입니다. 상단의 서버 연결 새로고침이나 수동 동기화를 사용해 주세요.</p></div>}
    {canBrowse && <>
      <div className="community-search"><label>플랫폼<select aria-label="커뮤니티 플랫폼" value={draftPlatform} onChange={event => setDraftPlatform(event.target.value as Platform)}><option value="SWEA">SWEA</option><option value="PROGRAMMERS">프로그래머스</option></select></label><label>문제 번호<input aria-label="커뮤니티 문제 번호" value={draftProblem} onChange={event => setDraftProblem(event.target.value)} maxLength={100} placeholder="문제 번호 입력" /></label><button type="button" className="primary-button" onClick={searchProblem} disabled={!problemPattern.test(draftProblem.trim())}>문제 찾기</button></div>
      <div className="community-own-problems"><strong>내 문제에서 찾기</strong><input aria-label="내 문제 검색" value={problemSearch} onChange={event => setProblemSearch(event.target.value)} placeholder="제목 또는 번호 검색" /><div>{matchingGroups.slice(0, 30).map(group => <button type="button" key={group.key} onClick={() => selectProblem(group.platform, group.problemNumber)}>{group.platform} #{group.problemNumber} · {group.title}</button>)}{matchingGroups.length === 0 && <p>일치하는 내 문제가 없습니다. 위에서 문제 번호를 직접 입력할 수 있습니다.</p>}</div></div>
      {!route.problemNumber ? <div className="community-notice"><strong>문제를 선택해 주세요</strong><p>공개 풀이 조회는 같은 문제를 푼 뒤 내 풀이를 명시적으로 공개한 경우에만 가능합니다.</p></div> : <>
        <div className="community-problem-heading"><div><span>{route.platform} #{route.problemNumber}</span><h2>{ownGroups.find(group => group.platform === route.platform && group.problemNumber === route.problemNumber)?.title ?? `문제 #${route.problemNumber}`}</h2></div><button type="button" className="ghost-button" onClick={() => onReturnToArchive(route.platform, route.problemNumber)}>내 문제로 돌아가기</button></div>
        <div className="community-visibility"><strong>내 풀이 공개 설정</strong><p>내가 공개한 풀이가 하나 이상 있어야 다른 사용자의 코드를 볼 수 있습니다. 공개하면 코드와 표시 이름·닉네임이 다른 자격 있는 사용자에게 보입니다.</p>{ownForProblem.length === 0 && <p>서버에 저장된 내 풀이가 없습니다. 먼저 풀이를 동기화해 주세요.</p>}{ownForProblem.map(solution => <div className="community-own-solution" key={solution.id}><span>{canonicalLanguageDisplayName(solution.language)} · {solution.visibility === 'published' ? '공개 중' : solution.result === 'ACCEPTED' ? '비공개' : '통과한 풀이만 공개 가능'}</span><button type="button" disabled={visibilityBusy || (solution.visibility !== 'published' && solution.result !== 'ACCEPTED')} onClick={() => { setConfirmId(solution.id!); setVisibilityError(null) }}>{solution.visibility === 'published' ? '공개 취소' : '공개하기'}</button></div>)}{visibilityError && <p role="alert">{visibilityError}</p>}{candidate && <div className="community-confirm" role="dialog" aria-label="풀이 공개 설정 확인"><strong>{candidate.visibility === 'published' ? '공개를 취소할까요?' : '이 코드를 공개할까요?'}</strong><p>{candidate.visibility === 'published' ? '이 풀이를 비공개로 바꾸면 다른 사용자의 접근이 차단됩니다.' : '아래 코드와 내 표시 이름·닉네임이 같은 문제를 공개한 사용자에게 보입니다.'}</p><pre aria-label="공개 대상 코드">{candidate.sourceCode}</pre><div><button type="button" className="ghost-button" onClick={() => setConfirmId(null)} disabled={visibilityBusy}>취소</button><button type="button" className="primary-button" onClick={() => void changeVisibility(candidate)} disabled={visibilityBusy}>{visibilityBusy ? '변경 중…' : candidate.visibility === 'published' ? '공개 취소 확인' : '이 풀이 공개 확인'}</button></div></div>}</div>
        <div className="community-results-heading"><strong>다른 사용자의 공개 풀이</strong><div><label>언어<select aria-label="커뮤니티 언어 필터" value={route.languageKey} onChange={event => onRouteChange({ ...route, languageKey: event.target.value, page: 0, detailId: null })}><option value="">모든 언어</option>{languageKeys.map(key => <option value={key} key={key}>{key}</option>)}</select></label><button type="button" className="ghost-button" onClick={() => setRefresh(value => value + 1)}>새로고침</button></div></div>
        {(!currentList || currentList.status === 'loading') && <p className="community-status" role="status">공개 풀이를 불러오는 중…</p>}
        {currentList?.status === 'eligibility' && <p className="community-status" role="status">{currentList.message} 위의 내 풀이 공개 설정에서 직접 공개할 수 있습니다.</p>}
        {currentList?.status === 'error' && <p className="community-status" role="alert">{currentList.message}</p>}
        {currentList?.status === 'ready' && <><label className="community-list-search">현재 페이지 결과 검색<input aria-label="공개 풀이 검색" value={listSearch} onChange={event => setListSearch(event.target.value)} placeholder="작성자·언어·제목" /></label><div className="community-results">{visibleSummaries.map(item => <button type="button" key={item.id} className={route.detailId === item.id ? 'selected' : ''} onClick={() => onRouteChange({ ...route, detailId: item.id })}><span>{item.author.name}{item.author.nickname ? ` · ${item.author.nickname}` : ''}</span><strong>{item.title}</strong><small>{canonicalLanguageDisplayName(item.language)} · {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('ko-KR') : '공개 시각 없음'}</small></button>)}{visibleSummaries.length === 0 && <p>{listSearch ? '현재 페이지에 일치하는 풀이가 없습니다.' : '이 문제에 공개된 다른 풀이가 없습니다.'}</p>}</div><div className="community-pages"><span>{currentList.data?.total ?? 0}개 · {route.page + 1}페이지</span><button type="button" disabled={route.page === 0} onClick={() => onRouteChange({ ...route, page: route.page - 1, detailId: null })}>이전</button><button type="button" disabled={!currentList.data?.hasMore} onClick={() => onRouteChange({ ...route, page: route.page + 1, detailId: null })}>다음</button></div></>}
        {route.detailId && <div className="community-detail"><div><strong>다른 풀이 보기</strong><button type="button" className="ghost-button" onClick={() => onRouteChange({ ...route, detailId: null })}>목록으로</button></div>{(!currentDetail || currentDetail.status === 'loading') && <p role="status">풀이를 불러오는 중…</p>}{currentDetail?.status === 'error' && <p role="alert">{currentDetail.message}</p>}{currentDetail?.status === 'ready' && currentDetail.data && <><h3>{currentDetail.data.title}</h3><p>{currentDetail.data.author.name} · {canonicalLanguageDisplayName(currentDetail.data.language)} · 실행 시간 {formatExecutionTime(currentDetail.data.executionTime ?? undefined)} · 메모리 {formatMemory({ memoryValue: currentDetail.data.memoryValue ?? undefined, memoryUnit: currentDetail.data.memoryUnit ?? undefined })}</p><CodeBlock code={currentDetail.data.sourceCode} language={currentDetail.data.language} lightTheme={lightTheme} darkTheme={darkTheme} /></>}</div>}
      </>}
    </>}
  </section>
}
