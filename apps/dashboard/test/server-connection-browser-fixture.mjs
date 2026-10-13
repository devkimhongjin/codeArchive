// Real dashboard/browser UI, synthetic API and bridge only. No deployed server
// requests, real credentials, user captures, uploads, or GitHub commits.
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const user = { id: 9001, githubId: 'synthetic-account', githubLogin: 'connection-fixture' }
const settings = { version: 1, nickname: '테스트 사용자', lightTheme: 'github-light', darkTheme: 'github-dark', autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: false, githubStatus: 'UNAVAILABLE', downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: '{platform}/{number}/{capture_ID}' }
const solutions = [{ captureId: '00000000-0000-4000-8000-000000000001', platform: 'SWEA', problemNumber: '1234', title: '서버 연결 테스트 문제', language: 'Java', sourceCode: '// Synthetic code only', result: 'ACCEPTED' }]
const released = new Set(), waiters = new Map()
async function wait(phase) { if (released.has(phase)) return; await new Promise(resolve => { const pending = waiters.get(phase) ?? []; pending.push(resolve); waiters.set(phase, pending) }) }
function release(phase) { released.add(phase); (waiters.get(phase) ?? []).forEach(resolve => resolve()); waiters.delete(phase) }
const runtime = `export const fixtureRuntime = { sendMessage: (_id, message, callback) => queueMicrotask(() => callback(message.type === 'CONNECT' ? { capability: 'synthetic-only', version: '1.0.1', features: [] } : message.type === 'GET_STATUS' ? { pendingCount: 0 } : message.type === 'GET_ALL' || message.type === 'GET_PENDING' ? { captures: [] } : { ok: true, reused: false })) };`
const plugin = {
  name: 'synthetic-server-connection-fixture',
  resolveId(id) { if (id === 'virtual:connection-fixture') return '\0connection-fixture' },
  load(id) { if (id === '\0connection-fixture') return runtime },
  transform(source, id) {
    if (id.endsWith('/src/bridge.ts')) return `import { fixtureRuntime } from 'virtual:connection-fixture';\n${source.replace('options.runtime ?? runtimeFromWindow()', 'options.runtime ?? fixtureRuntime')}`
    if (id.endsWith('/src/navigation.ts')) return `export function navigateSameTab() { window.dispatchEvent(new CustomEvent('codearchive-login-start', { detail: 'login' })); window.open('/__fixture/login', '_blank'); }`
    if (id.endsWith('/src/extensionEnvironment.ts')) return source.replace('export function subscribeExtensionLogin(', 'function unusedRealLoginSubscription(') + `\nexport function subscribeExtensionLogin(onComplete) { const listener = event => { if (event.origin === location.origin && event.data === 'synthetic-connection-login-complete') onComplete(''); }; window.addEventListener('message', listener); return () => window.removeEventListener('message', listener); }`
  },
  transformIndexHtml(html) {
    return html.replace('<head>', `<head><script>const fixtureFetch = window.fetch.bind(window); window.fetch = (input, init = {}) => { if (typeof input === 'string' && input.startsWith('/api/')) { const headers = new Headers(init.headers); headers.set('X-Fixture-Scenario', new URL(location.href).searchParams.get('scenario') || 'delay'); return fixtureFetch(input, { ...init, headers }); } return fixtureFetch(input, init); };</script>`)
      .replace('<body>', '<body><div style="padding:8px;background:#fff0c2;text-align:center">합성 데이터로 UI 검증 중 · 실제 로그인/서버 업로드/GitHub 커밋 없음</div>')
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1:4181')
      const json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
      if (url.pathname === '/__fixture/control') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.end('<!doctype html><html lang="ko"><title>합성 응답 제어</title><body><h1>합성 응답 제어</h1><p>실제 서버와 사용자 데이터는 사용하지 않습니다.</p><button onclick="fetch(\'/__fixture/release?phase=auth\', {method:\'POST\'}).then(()=>this.textContent=\'로그인 응답 허용 완료\')">로그인 응답 허용</button><button onclick="fetch(\'/__fixture/release?phase=list\', {method:\'POST\'}).then(()=>this.textContent=\'풀이 응답 허용 완료\')">풀이 응답 허용</button><button onclick="fetch(\'/__fixture/release?phase=recover\', {method:\'POST\'}).then(()=>this.textContent=\'오류 복구 허용 완료\')">오류 복구 허용</button></body></html>')
      }
      if (url.pathname === '/__fixture/release' && req.method === 'POST') { release(url.searchParams.get('phase')); return json({ syntheticOnly: true }) }
      if (url.pathname === '/__fixture/login') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.end('<!doctype html><html lang="ko"><title>합성 로그인 검증</title><body><h1>합성 로그인 검증</h1><p>실제 GitHub 인증·계정·비밀값을 사용하지 않습니다.</p><button onclick="fetch(\'/__fixture/release?phase=login\', {method:\'POST\'}).then(()=>{window.opener.postMessage(\'synthetic-connection-login-complete\', location.origin); this.textContent=\'합성 로그인 승인 완료\';})">합성 로그인 승인</button></body></html>')
      }
      if (url.pathname === '/__fixture/narrow') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        const scenario = ['delay', 'login', 'signed-out', 'error'].includes(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') : 'delay'
        return res.end(`<!doctype html><html lang="ko"><title>390px 좁은 화면 검증</title><body><h1>390px 좁은 프레임 · 합성 데이터</h1><iframe title="390px 대시보드" src="/?scenario=${scenario}" style="width:390px;height:844px;border:1px solid #ccc"></iframe></body></html>`)
      }
      if (!url.pathname.startsWith('/api/')) return next()
      const scenario = req.headers['x-fixture-scenario'] ?? 'delay'
      if (url.pathname === '/api/auth/me') {
        if (scenario === 'signed-out') return json({ message: 'Synthetic signed out' }, 401)
        if (scenario === 'login' && !released.has('login')) return json({ message: 'Synthetic login required' }, 401)
        if (scenario === 'error' && !released.has('recover')) return json({ message: 'Synthetic unavailable' }, 503)
        if (scenario === 'delay') await wait('auth')
        return json(user)
      }
      if (url.pathname === '/api/solutions') {
        if (scenario === 'list-error') return json({ message: 'Synthetic archive unavailable' }, 503)
        if (scenario === 'delay' || scenario === 'login') await wait('list')
        return json(solutions)
      }
      if (url.pathname === '/api/settings') return json(settings)
      if (url.pathname === '/api/auth/providers') return json({ github: { enabled: true, loginUrl: '/api/oauth2/authorization/github' } })
      if (url.pathname === '/api/auth/csrf') return json({ headerName: 'X-XSRF-TOKEN', token: 'synthetic-only' })
      return json({ message: 'No real endpoint in fixture' }, 404)
    })
  },
}
const server = await createServer({ root, plugins: [plugin], server: { host: '127.0.0.1', port: 4181, strictPort: true, proxy: {} } })
await server.listen()
console.log('Synthetic server connection UI: http://127.0.0.1:4181/?scenario=delay; control: /__fixture/control')
