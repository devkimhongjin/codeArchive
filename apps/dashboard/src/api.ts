import { GITHUB_LOGIN_URL, type AccountSettings, type AuthProviders, type BulkResponse, type Capture, type RelayGrant, type Solution, type User, type GithubInstallation, type GithubInstallationStart, type GithubRepositoryTarget, type GithubBranchTarget, type GithubDirectoryTarget, type GithubTreePage, type GithubAddFileRequest, type GithubTreeOperationPreviewRequest, type GithubTreeOperationPreview, type GithubPage, type CommunityPage, type CommunityDetail, type Platform } from './types'

export { GITHUB_LOGIN_URL } from './types'

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

type CsrfResponse = { headerName?: string; token?: string }

let csrfState: { headerName: string; token: string } | null = null

async function ensureCsrf(force = false) {
  if (csrfState && !force) return csrfState
  const response = await fetch('/api/auth/csrf', { credentials: 'include' })
  const payload = (await readPayload(response)) as CsrfResponse | undefined
  if (!response.ok || !payload?.token) {
    throw new ApiError('보안 토큰을 가져오지 못했습니다.', response.status || 500, payload)
  }
  csrfState = {
    headerName: payload.headerName ?? 'X-XSRF-TOKEN',
    token: payload.token,
  }
  return csrfState
}

export async function refreshCsrf() {
  csrfState = null
  return ensureCsrf(true)
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return undefined
    }
  }
  return response.text().catch(() => undefined)
}

export async function requestJson<T>(path: string, init: RequestInit = {}, retryCsrf = true): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = await ensureCsrf()
    headers.set(csrf.headerName, csrf.token)
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  })
  const payload = await readPayload(response)
  if (!response.ok && retryCsrf && response.status === 403 && method !== 'GET' && method !== 'HEAD') {
    // Tokens can age out independently of the session. Refresh once before giving
    // a mutation a useful error; never repeat a valid mutation twice.
    await ensureCsrf(true)
    return requestJson(path, init, false)
  }
  if (!response.ok) {
    const payloadMessage =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message?: unknown }).message)
        : undefined
    throw new ApiError(payloadMessage ?? `요청을 처리하지 못했습니다 (${response.status})`, response.status, payload)
  }
  return payload as T
}

export async function getMe(): Promise<User> {
  return requestJson<User>('/api/auth/me')
}

export async function getAuthProviders(): Promise<AuthProviders> {
  const payload = await requestJson<Partial<AuthProviders>>('/api/auth/providers')
  const github = payload?.github
  return {
    github: {
      // Only the documented same-origin path can be used for OAuth. A malformed
      // response must fail closed instead of turning into an arbitrary redirect.
      enabled: github?.enabled === true && github.loginUrl === GITHUB_LOGIN_URL,
      loginUrl: GITHUB_LOGIN_URL,
    },
  }
}

export async function logout(): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST' })
  // The session is already gone. Fetch a fresh token lazily for the next
  // mutation; a failed refresh must never keep private data on screen.
  csrfState = null
}

export function accountAssertionHeaders(githubId: string): HeadersInit {
  return { 'X-CodeArchive-Account': githubId }
}

export const EXPECTED_GITHUB_ID_HEADER = 'X-CodeArchive-Github-Id'
export function expectedGithubIdHeaders(githubId: string): HeadersInit {
  return { [EXPECTED_GITHUB_ID_HEADER]: githubId }
}

export async function getSolutions(expectedGithubId: string): Promise<Solution[]> {
  const payload = await requestJson<Solution[] | { solutions?: Solution[] }>('/api/solutions', {
    headers: accountAssertionHeaders(expectedGithubId),
  })
  return Array.isArray(payload) ? payload : payload.solutions ?? []
}

export function getCommunitySolutions(expectedGithubId: string, platform: Platform, problemNumber: string, languageKey: string, page: number): Promise<CommunityPage> {
  const query = new URLSearchParams({ platform, problemNumber, page: String(page), size: '20' })
  if (languageKey) query.set('languageKey', languageKey)
  return requestJson<CommunityPage>(`/api/community/solutions?${query}`, { headers: expectedGithubIdHeaders(expectedGithubId) })
}

export const getCommunityDetail = (expectedGithubId: string, id: number) => requestJson<CommunityDetail>(`/api/community/solutions/${id}`, { headers: expectedGithubIdHeaders(expectedGithubId) })
export const setCommunityVisibility = (expectedGithubId: string, id: number, visibility: 'private' | 'published') => requestJson<{ visibility: 'private' | 'published'; publishedAt: string | null }>(`/api/community/solutions/${id}/visibility`, { method: 'PUT', headers: expectedGithubIdHeaders(expectedGithubId), body: JSON.stringify({ visibility }) })

export async function bulkUpload(captures: Capture[], expectedGithubId: string): Promise<BulkResponse> {
  return requestJson<BulkResponse>('/api/solutions/bulk', {
    method: 'POST',
    headers: accountAssertionHeaders(expectedGithubId),
    body: JSON.stringify({ captures }),
  })
}

export async function getAccountSettings(expectedGithubId: string): Promise<AccountSettings> { return requestJson<AccountSettings>('/api/settings', { headers: expectedGithubIdHeaders(expectedGithubId) }) }
export async function updateAccountSettings(settings: AccountSettings, expectedGithubId: string): Promise<AccountSettings> {
  return requestJson<AccountSettings>('/api/settings', { method: 'PUT', headers: expectedGithubIdHeaders(expectedGithubId), body: JSON.stringify(settings) })
}

export async function issueRelayGrant(deviceId: string, generation: number, expectedGithubId: string): Promise<RelayGrant> {
  return requestJson<RelayGrant>('/api/relay/grants', {
    method: 'POST',
    headers: expectedGithubIdHeaders(expectedGithubId),
    body: JSON.stringify({ deviceId, generation }),
  })
}

/**
 * The relay route is intentionally separate from normal dashboard auth. Older
 * servers may not expose this revocation route yet; callers still clear the
 * extension first, so a failed network request can never keep local relay on.
 */
export async function revokeRelayGrant(deviceId: string, expectedGithubId: string): Promise<void> {
  await requestJson(`/api/relay/grants/${encodeURIComponent(deviceId)}`, { method: 'DELETE', headers: expectedGithubIdHeaders(expectedGithubId) })
}
export const getGithubInstallations = (expectedGithubId: string) => requestJson<GithubInstallation[]>('/api/github/targets/installations', { headers: expectedGithubIdHeaders(expectedGithubId) })
export const startGithubInstallation = (expectedGithubId: string) => requestJson<GithubInstallationStart>('/api/github/installations/start', { method: 'POST', headers: expectedGithubIdHeaders(expectedGithubId) })
export const getGithubRepositories = (expectedGithubId: string, installationId: number, page = 1) => requestJson<GithubPage<GithubRepositoryTarget>>(`/api/github/targets/installations/${installationId}/repositories?page=${page}`, { headers: expectedGithubIdHeaders(expectedGithubId) })
export const getGithubBranches = (expectedGithubId: string, installationId: number, repositoryId: number, page = 1) => requestJson<GithubPage<GithubBranchTarget>>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/branches?page=${page}`, { headers: expectedGithubIdHeaders(expectedGithubId) })
export const getGithubDirectories = (expectedGithubId: string, installationId: number, repositoryId: number, branch: string, path = '') => requestJson<GithubDirectoryTarget>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/directories?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`, { headers: expectedGithubIdHeaders(expectedGithubId) })
export const getGithubTree = (expectedGithubId: string, installationId: number, repositoryId: number, branch: string, path = '', page = 1) => requestJson<GithubTreePage>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/tree?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&page=${page}`, { headers: expectedGithubIdHeaders(expectedGithubId) })
export const addGithubFile = (expectedGithubId: string, installationId: number, repositoryId: number, request: GithubAddFileRequest) => requestJson<{ commitSha: string }>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/files`, { method: 'POST', headers: expectedGithubIdHeaders(expectedGithubId), body: JSON.stringify(request) })
export const previewGithubTreeOperation = (expectedGithubId: string, installationId: number, repositoryId: number, request: GithubTreeOperationPreviewRequest) => requestJson<GithubTreeOperationPreview>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/tree-operations/preview`, { method: 'POST', headers: expectedGithubIdHeaders(expectedGithubId), body: JSON.stringify(request) })
export const commitGithubTreeOperation = (expectedGithubId: string, installationId: number, repositoryId: number, previewId: string) => requestJson<{ commitSha: string; recovery: string }>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/tree-operations/commit`, { method: 'POST', headers: expectedGithubIdHeaders(expectedGithubId), body: JSON.stringify({ previewId }) })
export const getGithubEmptyDefaultBranch = (expectedGithubId: string, installationId: number, repositoryId: number) => requestJson<{ defaultBranch: string }>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/empty-default-branch`, { headers: expectedGithubIdHeaders(expectedGithubId) })
export const getGithubReadmePreview = (expectedGithubId: string) => requestJson<{ content: string }>('/api/github/targets/readme-preview', { headers: expectedGithubIdHeaders(expectedGithubId) })
export const initializeGithubReadme = (expectedGithubId: string, installationId: number, repositoryId: number) => requestJson<{ defaultBranch: string }>(`/api/github/targets/installations/${installationId}/repositories/${repositoryId}/initialize-readme`, { method: 'POST', headers: expectedGithubIdHeaders(expectedGithubId) })
