import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountAssertionHeaders, bulkUpload, GITHUB_LOGIN_URL, getAccountSettings, getAuthProviders, getGithubBranches, getGithubDirectories, getGithubInstallations, getGithubRepositories, startGithubInstallation, getSolutions, expectedGithubIdHeaders, getMe } from './api'

describe('session checks recover from transient reads without replaying authentication failures',()=>{
  afterEach(()=>vi.unstubAllGlobals())
  const session=()=>new Response(JSON.stringify({id:1,githubId:'123',githubLogin:'synthetic'}),{headers:{'content-type':'application/json'}})
  it.each([new TypeError('offline'),new DOMException('timeout','TimeoutError')])('retries a failed read once (%s)',async error=>{
    const request=vi.fn<typeof fetch>().mockRejectedValueOnce(error).mockResolvedValueOnce(session());vi.stubGlobal('fetch',request)
    await expect(getMe()).resolves.toMatchObject({id:1});expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([url,init])=>url==='/api/auth/me'&&(!init?.method||init.method==='GET')&&init?.signal)).toBe(true)
  })
  it('recovers from a transient service response',async()=>{
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(session());vi.stubGlobal('fetch',request)
    await expect(getMe()).resolves.toMatchObject({id:1});expect(request).toHaveBeenCalledTimes(2)
  })
  it.each([401,403])('does not retry a confirmed denial (%s)',async status=>{
    const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status}));vi.stubGlobal('fetch',request)
    await expect(getMe()).rejects.toMatchObject({status});expect(request).toHaveBeenCalledTimes(1)
  })
  it('stops after the second transient failure',async()=>{
    const request=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));vi.stubGlobal('fetch',request)
    await expect(getMe()).rejects.toThrow('offline');expect(request).toHaveBeenCalledTimes(2)
  })
  it('retries a truncated successful response without treating it as authentication',async()=>{
    const truncated=new Response('{"id":',{headers:{'content-type':'application/json'}})
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(truncated).mockResolvedValueOnce(session());vi.stubGlobal('fetch',request)
    await expect(getMe()).resolves.toMatchObject({id:1});expect(request).toHaveBeenCalledTimes(2)
  })
  it('recovers when the successful response body aborts after its headers',async()=>{
    const interrupted=new Response(null,{headers:{'content-type':'application/json'}})
    vi.spyOn(interrupted,'json').mockRejectedValue(new DOMException('timeout','TimeoutError'))
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(interrupted).mockResolvedValueOnce(session());vi.stubGlobal('fetch',request)
    await expect(getMe()).resolves.toMatchObject({id:1});expect(request).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid sessions after two responses without manufacturing a signed-out status',async()=>{
    const request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{}',{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',request)
    await expect(getMe()).rejects.toMatchObject({status:0});expect(request).toHaveBeenCalledTimes(2)
  })
})

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

  it('binds settings and every GitHub target browse read to the rendered immutable GitHub id', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1 }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], hasMore: false }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], hasMore: false }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ currentPath: '', parentPath: '', directories: [] }), { headers: { 'content-type': 'application/json' } }))

    await getAccountSettings('42'); await getGithubInstallations('42'); await getGithubRepositories('42', 7, 2); await getGithubBranches('42', 7, 8, 2); await getGithubDirectories('42', 7, 8, 'release/v1', 'src')
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init?.headers).get('X-CodeArchive-Github-Id')).toBe('42')
    expect(expectedGithubIdHeaders('42')).toEqual({ 'X-CodeArchive-Github-Id': '42' })
  })
})

describe('GitHub installation return routing', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps the legacy endpoint v1 and opts a bundled extension into the direct endpoint explicitly', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ headerName: 'X-XSRF-TOKEN', token: 'csrf-token' }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'INSTALL_REQUIRED', installations: [], installUrl: 'legacy' }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'INSTALL_REQUIRED', installations: [], installUrl: 'direct' }), { headers: { 'content-type': 'application/json' } }))

    await startGithubInstallation('42', false)
    await startGithubInstallation('42', true)

    const starts = fetchMock.mock.calls.map(([url]) => url).filter(url => typeof url === 'string' && url.includes('/api/github/installations'))
    expect(starts).toEqual(['/api/github/installations/start', '/api/github/installations/extension/start'])
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
