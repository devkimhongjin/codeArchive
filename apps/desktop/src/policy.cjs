const REMOTE_ORIGIN = 'https://codearchive-dashboard-beta.netlify.app';
const EXTENSION_ID = 'oohlcmihldmfninmdcmanddfmhoonmdl';
const BRIDGE_PORT = 18791;
const APP_URL = 'codearchive://app/index.html';
function apiRequest(input) {
  if (!input || typeof input.path !== 'string' || !input.path.startsWith('/api/') || /[\\\x00-\x20#]/.test(input.path)) throw new Error('허용되지 않은 API 주소입니다.');
  const url = new URL(input.path, REMOTE_ORIGIN);
  if (url.origin !== REMOTE_ORIGIN || !url.pathname.startsWith('/api/') || url.username || url.password) throw new Error('허용되지 않은 API 주소입니다.');
  const method = input.method ?? 'GET';
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(method)) throw new Error('허용되지 않은 요청입니다.');
  const headers = {};
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (!['content-type', 'x-xsrf-token', 'x-codearchive-account', 'x-codearchive-github-id'].includes(key.toLowerCase()) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('허용되지 않은 헤더입니다.');
    headers[key] = value;
  }
  if (input.body !== undefined && (typeof input.body !== 'string' || Buffer.byteLength(input.body) > 32 * 1024 * 1024)) throw new Error('요청이 너무 큽니다.');
  return { url: url.href, method, headers, ...(input.body === undefined ? {} : { body: input.body }) };
}
function trustedRenderer(senderFrame, mainContents) {
  if (!senderFrame || senderFrame !== mainContents.mainFrame) return false;
  try { const url = new URL(senderFrame.url); return url.origin === 'null' && url.protocol === 'codearchive:' && url.hostname === 'app' && url.pathname === '/index.html'; } catch { return false; }
}
function authUrl(value) {
  const url = new URL(value, REMOTE_ORIGIN);
  if (url.username || url.password) throw new Error('허용되지 않은 로그인 주소입니다.');
  if (url.origin === REMOTE_ORIGIN && url.pathname === '/api/oauth2/authorization/github') return url.href;
  if (url.origin === 'https://github.com' && /^\/apps\/[\w-]+\/installations\/new$/.test(url.pathname)) return url.href;
  throw new Error('허용되지 않은 로그인 주소입니다.');
}
function externalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !['github.com', 'jungol.co.kr', 'swexpertacademy.com', 'school.programmers.co.kr', 'codearchive-dashboard-beta.netlify.app'].includes(url.hostname)) throw new Error('허용되지 않은 링크입니다.');
  return url.href;
}
module.exports = { REMOTE_ORIGIN, EXTENSION_ID, BRIDGE_PORT, APP_URL, apiRequest, trustedRenderer, authUrl, externalUrl };
