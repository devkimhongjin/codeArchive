// Local-only browser verification: renders the real App and uses the real API client.
// All server and extension responses are synthetic. No user captures or credentials
// are loaded, and no requests are proxied to a deployed service.
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const currentVersion = JSON.parse(await readFile(new URL('../../../release.json', import.meta.url), 'utf8')).version
const extensionRoot = fileURLToPath(new URL('../../extension/', import.meta.url)).replaceAll('\\', '/')
const popupHtml = await readFile(new URL('../../extension/src/popup.html', import.meta.url), 'utf8')
const user = { id: 9001, githubId: 'fixture-account', githubLogin: 'browser-fixture' }
const settings = {
  version: 7, name: null, nickname: 'browser-fixture', copyHeader: false, downloadHeader: false, githubHeader: false,
  downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: '{platform}/{number}/{capture_ID}',
  githubCommitMessageTemplate: '{platform} {number}', lightTheme: 'github-light', darkTheme: 'github-dark',
  autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: true, githubStatus: 'AVAILABLE',
  githubInstallationId: 9001, githubOwner: 'fixture-owner', githubRepository: 'fixture-archive',
  githubBranch: 'fixture-branch', githubRootPath: 'solutions',
}
const capture = (index, platform) => ({
  captureId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, platform,
  historicalImport: true, historicalSubmissionId: platform === 'JUNGOL' ? String(index) : platform === 'SWEA' ? `Aa${String(index).padStart(8, '0')}` : `pg:fixture:${index}:2026-01-01T00:00:00.000+09:00:java`,
  problemNumber: String(index), title: `테스트 문제 ${index}`, language: 'Java', languageKey: 'java',
  solvedAt: '2026-01-01T00:00:00.000+09:00', sourceCode: '// synthetic browser fixture', result: 'ACCEPTED',
  problemUrl: 'https://example.test/problem',
})
const captures = [...Array.from({ length: 54 }, (_, i) => capture(i + 1, 'JUNGOL')), capture(501, 'SWEA'), capture(502, 'SWEA'), capture(601, 'PROGRAMMERS'), capture(602, 'PROGRAMMERS')]
const archiveFixtures = process.env.CODEARCHIVE_BROWSER_PAGINATION === 'true'
  ? [...Array.from({ length: 45 }, (_, i) => ({ ...capture(7001 + i, i % 2 ? 'SWEA' : 'PROGRAMMERS'), historicalImport: false, historicalSubmissionId: undefined })),
    { ...captures[0], captureId: '00000000-0000-4000-9000-000000000001', historicalImport: false, historicalSubmissionId: undefined }]
  : []
const metadata = ({ sourceCode, result, problemUrl, languageKey, historicalImport, ...record }) => record
const stored = new Map([captures[0], captures[54], captures[56]].map(record => [record.captureId, record]))
const states = new Map([[captures[0].captureId, 'SUCCEEDED'], [captures[54].captureId, 'FAILED'], [captures[56].captureId, 'UNKNOWN']])
const uploads = [], commits = [], acknowledgements = []
let failedOnce = false
const runtimeModule = `
const captures = ${JSON.stringify(captures)};
export const fixtureRuntime = { sendMessage: (_id, message, callback) => {
  let result;
  switch (message.type) {
    case 'CONNECT': result = { capability: 'synthetic-capability', version: ${JSON.stringify(currentVersion)}, features: ['history-v1'] }; break;
    case 'GET_STATUS': result = { pendingCount: 0 }; break;
    case 'GET_PENDING': result = { captures: [] }; break;
    case 'GET_ALL': result = { captures }; break;
    case 'GET_HISTORICAL_METADATA': result = { localOnly: true, records: captures.map(({ sourceCode, result, problemUrl, languageKey, historicalImport, ...record }) => record) }; break;
    case 'GET_HISTORICAL_BY_SUBMISSION_IDS': result = { localOnly: true, captures: captures.filter(record => record.platform === message.platform && message.submissionIds.includes(record.historicalSubmissionId)) }; break;
    case 'ACK': fetch('/__fixture/ack', { method: 'POST', body: JSON.stringify(message.captureIds) }); result = { ok: true }; break;
    case 'GET_DEVICE_ID': result = { deviceId: 'synthetic-device' }; break;
    case 'RELAY_REUSE': result = { reused: false }; break;
    default: result = { ok: true, reused: false };
  }
  queueMicrotask(() => callback(result));
} };
`
const plugin = {
  name: 'local-history-browser-fixture',
  resolveId(id) { if (id === 'virtual:history-fixture-runtime') return '\0history-fixture-runtime' },
  load(id) { if (id === '\0history-fixture-runtime') return runtimeModule },
  transform(source, id) {
    if (!id.endsWith('/src/bridge.ts')) return
    return `import { fixtureRuntime } from 'virtual:history-fixture-runtime';\n${source.replace('options.runtime ?? runtimeFromWindow()', 'options.runtime ?? fixtureRuntime')}`
  },
  transformIndexHtml(html) {
    return html.replace('<body>', '<body><div style="background:#ffe7a0;padding:8px;text-align:center">브라우저 검증용 테스트 데이터 · 실제 서버 업로드/GitHub 커밋 없음</div>')
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1:5178')
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__fixture/')) return next()
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
      const json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
      if (url.pathname === '/__fixture/popup') {
        res.setHeader('Content-Type', 'text/html')
        return res.end(popupHtml.replace('href="popup.css"', `href="/@fs/${extensionRoot}src/popup.css"`)
          .replace('href="popup-layout.css"', `href="/@fs/${extensionRoot}src/popup-layout.css"`)
          .replace('<script src="popup.js"></script>', `<script type="module">
            import { mountPopup } from '/@fs/${extensionRoot}src/popupView.ts';
            const tag = 'extension-v0.2.3'; let checks = 0;
            const release = { schemaVersion: 1, version: '0.2.3', releasedAt: '2026-10-06', commit: 'a'.repeat(40), extensionId: 'oohlcmihldmfninmdcmanddfmhoonmdl', minimumChromeVersion: '120',
              compatibility: { minimumDashboardVersion: '0.2.2', minimumApiVersion: '0.2.2', dashboardMinimumExtensionVersion: '0.2.3' },
              artifact: { name: 'codearchive-extension.zip', sha256: 'b'.repeat(64) }, releasePageUrl: 'https://github.com/devkimhongjin/codeArchive/releases/tag/'+tag,
              downloadUrl: 'https://github.com/devkimhongjin/codeArchive/releases/download/'+tag+'/codearchive-extension.zip', checksumUrl: 'https://github.com/devkimhongjin/codeArchive/releases/download/'+tag+'/codearchive-extension.zip.sha256' };
            mountPopup(document, { load: async () => ({ pendingCount: 3, settings: {}, recentCaptures: ${JSON.stringify([{ ...captures[0], observedAt: '2025-12-31T15:00:00.000Z', syncState: 'PENDING' }])} }), copy: async () => {},
              loadExtensionUpdate: async () => { await new Promise(resolve => setTimeout(resolve, 1500)); return { installedVersion: '0.2.2', checkedAt: Date.now(), status: checks++ ? 'unavailable' : 'checked', available: true, release }; }
            });
          </script>`).replace('<body>', '<body><div style="background:#ffe7a0;padding:8px">업데이트 안내 브라우저 검증 · 합성 릴리스</div>'))
      }
      if (url.pathname === '/__fixture/summary') return json({ uploadBatches: uploads, commitBatches: commits, acknowledged: acknowledgements, serverCount: stored.size, states: Object.fromEntries(states) })
      if (url.pathname === '/__fixture/ack') { acknowledgements.push(...body); return json({ ok: true }) }
      if (url.pathname === '/api/auth/csrf') return json({ headerName: 'X-XSRF-TOKEN', token: 'synthetic-csrf' })
      if (url.pathname === '/api/auth/me') return json(user)
      if (url.pathname === '/api/auth/providers') return json({ github: { enabled: true, loginUrl: '/api/oauth2/authorization/github' } })
      if (req.method !== 'GET' && req.headers['x-xsrf-token'] !== 'synthetic-csrf') return json({ message: 'Fixture CSRF missing' }, 403)
      if (url.pathname === '/api/settings') return json(settings)
      if (url.pathname === '/api/solutions') return json([...stored.values(), ...archiveFixtures])
      if (url.pathname === '/api/solutions/historical-submission-ids') return json([...stored.values()].filter(record => record.platform === url.searchParams.get('platform')).map(record => record.historicalSubmissionId))
      if (url.pathname === '/api/solutions/historical-github-candidates') return json([...stored.values()].map(record => ({ ...metadata(record), state: states.get(record.captureId) ?? 'NONE' })))
      if (url.pathname === '/api/solutions/bulk') {
        if (req.headers['x-codearchive-account'] !== user.githubId) return json({ message: 'Fixture account mismatch' }, 409)
        uploads.push(body.captures.map(record => record.captureId))
        await new Promise(resolve => setTimeout(resolve, 3500))
        const accepted = body.captures.filter(record => {
          if (!failedOnce && record.captureId === captures[1].captureId) { failedOnce = true; return false }
          return true
        })
        accepted.forEach(record => stored.set(record.captureId, record))
        return json({ acceptedCaptureIds: accepted.map(record => record.captureId), failures: [] })
      }
      if (url.pathname === '/api/solutions/historical-github-batch') {
        if (req.headers['x-codearchive-account'] !== user.githubId || body.settingsVersion !== settings.version || body.owner !== settings.githubOwner || body.repository !== settings.githubRepository || body.branch !== settings.githubBranch) return json({ message: 'Fixture target mismatch' }, 409)
        if (body.captureIds.some(id => !stored.has(id) || ['SUCCEEDED', 'UNKNOWN', 'PENDING', 'RUNNING'].includes(states.get(id)))) return json({ message: 'Fixture unsafe retry' }, 400)
        commits.push(body.captureIds)
        await new Promise(resolve => setTimeout(resolve, 1500))
        body.captureIds.forEach(id => states.set(id, 'PENDING'))
        setTimeout(() => body.captureIds.forEach(id => states.set(id, 'SUCCEEDED')), 2000)
        return json(Object.fromEntries(body.captureIds.map(id => [id, 'PENDING'])))
      }
      return json({ message: `Unimplemented fixture endpoint ${url.pathname}` }, 404)
    })
  },
}
const server = await createServer({ root, plugins: [plugin], server: { host: '127.0.0.1', port: 5178, strictPort: true, proxy: {},
  fs: { allow: [root, extensionRoot, fileURLToPath(new URL('../../../shared/', import.meta.url))] },
} })
await server.listen()
console.log('Synthetic history browser verification: http://127.0.0.1:5178')
