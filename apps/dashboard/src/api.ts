import { GITHUB_LOGIN_URL, type AuthProviders, type BulkResponse, type Capture, type Solution, type User } from './types'

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

export async function getSolutions(expectedGithubId: string): Promise<Solution[]> {
  const payload = await requestJson<Solution[] | { solutions?: Solution[] }>('/api/solutions', {
    headers: accountAssertionHeaders(expectedGithubId),
  })
  return Array.isArray(payload) ? payload : payload.solutions ?? []
}

export async function bulkUpload(captures: Capture[], expectedGithubId: string): Promise<BulkResponse> {
  return requestJson<BulkResponse>('/api/solutions/bulk', {
    method: 'POST',
    headers: accountAssertionHeaders(expectedGithubId),
    body: JSON.stringify({ captures }),
  })
}
