import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountAssertionHeaders, bulkUpload, GITHUB_LOGIN_URL, getAuthProviders, getSolutions } from './api'

describe('GitHub authentication contract', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts the enabled provider only with the fixed same-origin login path', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ github: { enabled: true, loginUrl: GITHUB_LOGIN_URL } }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(getAuthProviders()).resolves.toEqual({
      github: { enabled: true, loginUrl: GITHUB_LOGIN_URL },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/providers', expect.objectContaining({ credentials: 'include' }))
  })

  it('fails closed when the provider advertises an unsafe redirect', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ github: { enabled: true, loginUrl: 'https://github.com/login' } }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(getAuthProviders()).resolves.toEqual({
      github: { enabled: false, loginUrl: GITHUB_LOGIN_URL },
    })
  })
})

describe('GitHub account assertions', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses githubId for the list request account assertion', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ solutions: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    await getSolutions('github-user-42')
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('X-CodeArchive-Account')).toBe('github-user-42')
    expect(accountAssertionHeaders('github-user-42')).toEqual({ 'X-CodeArchive-Account': 'github-user-42' })
  })

  it('uses githubId for bulk uploads while retaining the CSRF fence', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ headerName: 'X-XSRF-TOKEN', token: 'csrf-token' }), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ acceptedCaptureIds: [], failures: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
      )

    await bulkUpload([], 'github-user-42')
    const init = fetchMock.mock.calls[1]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('X-CodeArchive-Account')).toBe('github-user-42')
    expect(headers.get('X-XSRF-TOKEN')).toBe('csrf-token')
  })
})

describe('logout session completion', () => {
  it('does not treat a later CSRF refresh outage as a failed logout', async () => {
    vi.resetModules()
    const api = await import('./api')
    let csrfRequests = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/api/auth/csrf') {
        csrfRequests += 1
        if (csrfRequests > 1) throw new Error('refresh offline')
        return new Response(JSON.stringify({ token: 'fresh', headerName: 'X-XSRF-TOKEN' }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === '/api/auth/logout') return new Response(null, { status: 204 })
      throw new Error('unexpected endpoint')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(api.logout()).resolves.toBeUndefined()
      expect(csrfRequests).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
