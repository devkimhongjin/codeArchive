import type { Platform, ViewName } from './types'

export type CommunityRoute = { platform: Platform; problemNumber: string; languageKey: string; page: number; detailId: number | null }
export const EMPTY_COMMUNITY_ROUTE: CommunityRoute = { platform: 'SWEA', problemNumber: '', languageKey: '', page: 0, detailId: null }

const routeKeys = ['view', 'platform', 'problemNumber', 'languageKey', 'page', 'solution'] as const

export function readView(search = window.location.search): ViewName {
  const view = new URLSearchParams(search).get('view')
  return view === 'community' ? 'community' : 'solutions'
}

export function readCommunityRoute(search = window.location.search): CommunityRoute {
  const params = new URLSearchParams(search)
  const rawPlatform = params.get('platform')
  const platform = rawPlatform === 'PROGRAMMERS' || rawPlatform === 'JUNGOL' ? rawPlatform : 'SWEA'
  const problem = params.get('problemNumber') ?? ''
  const language = params.get('languageKey') ?? ''
  const rawPage = params.get('page') ?? '0'
  const rawDetail = params.get('solution') ?? ''
  return {
    platform,
    problemNumber: /^[A-Za-z0-9_-]{1,100}$/.test(problem) ? problem : '',
    languageKey: /^[a-z0-9:._-]{1,100}$/.test(language) ? language : '',
    page: /^(0|[1-9][0-9]{0,3})$/.test(rawPage) && Number(rawPage) <= 1000 ? Number(rawPage) : 0,
    detailId: /^[1-9][0-9]{0,15}$/.test(rawDetail) && Number.isSafeInteger(Number(rawDetail)) ? Number(rawDetail) : null,
  }
}

export function urlForView(view: ViewName, route: CommunityRoute, location: { href: string } = window.location): string {
  const url = new URL(location.href)
  routeKeys.forEach(key => url.searchParams.delete(key))
  if (view === 'community') {
    url.searchParams.set('view', view)
    if (route.problemNumber) {
      url.searchParams.set('platform', route.platform)
      url.searchParams.set('problemNumber', route.problemNumber)
      if (route.languageKey) url.searchParams.set('languageKey', route.languageKey)
      if (route.page) url.searchParams.set('page', String(route.page))
      if (route.detailId) url.searchParams.set('solution', String(route.detailId))
    }
  }
  return `${url.pathname}${url.search}${url.hash}`
}
