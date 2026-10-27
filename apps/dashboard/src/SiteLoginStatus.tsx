import { useCallback, useEffect, useState } from 'react'
import { extensionMessage } from './extensionEnvironment'

type Platform = 'JUNGOL' | 'SWEA' | 'PROGRAMMERS'
type SiteState = { platform: Platform; state: 'SIGNED_IN' | 'SIGNED_OUT' | 'UNKNOWN'; name?: string }
type Response = { sites?: unknown; error?: string }

// Fixed here rather than taken from the extension's answer, so a link always
// points to the platform's own page.
const SITES: { platform: Platform; label: string; loginUrl: string; siteUrl: string }[] = [
  { platform: 'JUNGOL', label: '정올', loginUrl: 'https://jungol.co.kr/auth/signin', siteUrl: 'https://jungol.co.kr/' },
  { platform: 'SWEA', label: 'SWEA', loginUrl: 'https://swexpertacademy.com/main/identity/anonymous/loginPage.do', siteUrl: 'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do' },
  { platform: 'PROGRAMMERS', label: '프로그래머스', loginUrl: 'https://programmers.co.kr/account/sign_in?referer=https%3A%2F%2Fschool.programmers.co.kr%2Flearn%2Fchallenges', siteUrl: 'https://school.programmers.co.kr/learn/challenges' },
]

function validSites(value: unknown): SiteState[] | null {
  if (!Array.isArray(value)) return null
  const sites = value.filter((item): item is SiteState => !!item && typeof item === 'object' &&
    SITES.some(site => site.platform === (item as SiteState).platform) && ['SIGNED_IN', 'SIGNED_OUT', 'UNKNOWN'].includes((item as SiteState).state))
  return sites.length ? sites.map(site => ({ platform: site.platform, state: site.state, ...(typeof site.name === 'string' && site.name.length <= 80 ? { name: site.name } : {}) })) : null
}

const loadSiteLogins = () => extensionMessage<Response>({ type: 'SITE_LOGIN_STATUS' })

/** Shows whether the browser is signed in to each platform, with a link to sign in on the site itself. */
export function SiteLoginStatus({ load = loadSiteLogins }: { load?: () => Promise<Response> }) {
  const [sites, setSites] = useState<SiteState[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const refresh = useCallback(async () => {
    setChecking(true)
    try {
      const response = await load()
      const next = validSites(response?.sites)
      setSites(next); setFailed(!next)
    } catch { setFailed(true) } finally { setChecking(false) }
  }, [load])
  useEffect(() => {
    void refresh()
    // Signing in happens in another tab; check again when the user comes back.
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return <section className="history-card site-login-card" aria-label="사이트 로그인 상태">
    <div className="site-login-heading">
      <h2>사이트 로그인</h2>
      <button type="button" className="history-work-button" disabled={checking} onClick={() => void refresh()}>{checking ? '확인 중…' : '다시 확인'}</button>
    </div>
    <p>과거 풀이 수집과 제출현황의 동기화는 각 사이트에 로그인되어 있어야 합니다. 로그인은 사이트에서 직접 하며, CodeArchive는 사이트 비밀번호를 받거나 저장하지 않습니다.</p>
    {failed && !sites && <p className="site-login-error" role="alert">로그인 상태를 확인하지 못했습니다. 확장 프로그램을 새로고침한 뒤 다시 확인해 주세요.</p>}
    <ul className="site-login-list">
      {SITES.map(site => {
        const current = sites?.find(item => item.platform === site.platform)
        const state = current?.state
        const text = !current ? (checking ? '확인 중' : '확인 전') : state === 'SIGNED_IN' ? `로그인됨${current.name ? ` · ${current.name}` : ''}` : state === 'SIGNED_OUT' ? '로그인 필요' : '확인하지 못함'
        return <li key={site.platform} data-state={state ?? 'PENDING'}>
          <strong>{site.label}</strong>
          <span className="site-login-state" role="status">{text}</span>
          {state === 'SIGNED_IN'
            ? <a className="history-work-button" href={site.siteUrl} target="_blank" rel="noopener noreferrer">사이트 열기</a>
            : <a className="history-work-button active" href={site.loginUrl} target="_blank" rel="noopener noreferrer">로그인</a>}
        </li>
      })}
    </ul>
  </section>
}
