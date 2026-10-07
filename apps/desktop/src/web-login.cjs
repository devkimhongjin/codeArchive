const { randomBytes, createHash } = require('node:crypto');
const { REMOTE_ORIGIN } = require('./policy.cjs');
class WebLoginError extends Error {}
function createWebLogin({ fetch, openExternal, completed, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let current = null;
  function finish(context, error) {
    if (current !== context) return;
    current = null; clearTimer(context.timer);
    if (error) context.reject(error); else context.resolve({ ok: true });
  }
  async function start() {
    if (current) throw new WebLoginError('웹브라우저에서 로그인을 완료해 주세요.');
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    let context;
    const result = new Promise((resolve, reject) => { context = { verifier, state, resolve, reject, deadline: now() + 300000, exchanging: false }; });
    // A launch failure may arrive before the caller starts awaiting the completion promise.
    result.catch(() => {});
    current = context;
    context.timer = setTimer(() => finish(context, new WebLoginError('로그인 요청이 만료되었습니다. PC 앱에서 다시 로그인해 주세요.')), 300000);
    context.timer?.unref?.();
    try {
      const url = new URL('/api/desktop-auth/start', REMOTE_ORIGIN);
      url.searchParams.set('challenge', challenge); url.searchParams.set('state', state);
      // Open immediately: there is no API round trip before the browser launch.
      await openExternal(url.href);
      return await result;
    } catch (error) {
      const safe = error instanceof WebLoginError ? error : new WebLoginError('웹 로그인을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
      finish(context, safe); throw safe;
    }
  }
  async function receiveCompletion(value) {
    const context = current;
    if (!context || context.exchanging || now() >= context.deadline || typeof value !== 'string' || value.length > 512) return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.protocol !== 'codearchive:' || url.hostname !== 'auth' || url.port || url.username || url.password || url.hash) return false;
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length || url.searchParams.get('state') !== context.state) return false;
    if (url.pathname === '/failed' && keys.length === 1 && keys[0] === 'state') {
      finish(context, new WebLoginError('웹 로그인에 실패했거나 취소되었습니다. PC 앱에서 다시 시도해 주세요.')); return true;
    }
    if (url.pathname !== '/complete' || keys.length !== 3 || keys.some(key => !['state', 'requestId', 'code'].includes(key))) return false;
    const requestId = url.searchParams.get('requestId'), code = url.searchParams.get('code');
    if (!/^[A-Za-z0-9_-]{43}$/.test(requestId ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(code ?? '')) return false;
    context.exchanging = true; clearTimer(context.timer);
    try {
      const response = await fetch(`${REMOTE_ORIGIN}/api/desktop-auth/exchange`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, verifier: context.verifier, code }),
        credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15000)
      });
      if (response.status !== 200) throw new WebLoginError('로그인 요청이 만료되었거나 유효하지 않습니다. PC 앱에서 다시 시도해 주세요.');
      await completed(); finish(context); return true;
    } catch (error) {
      finish(context, error instanceof WebLoginError ? error : new WebLoginError('웹 로그인을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'));
      return false;
    }
  }
  return { start, pending: () => current !== null, receiveCompletion };
}
module.exports = { createWebLogin };
