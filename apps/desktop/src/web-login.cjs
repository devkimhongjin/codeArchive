const { randomBytes, createHash } = require('node:crypto');
const { REMOTE_ORIGIN } = require('./policy.cjs');
function createWebLogin({ fetch, openExternal, completed, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let pending = false;
  async function start() {
    if (pending) throw new Error('웹브라우저에서 로그인과 계정 승인을 완료해 주세요.');
    pending = true;
    try {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const request = async (path, body) => fetch(`${REMOTE_ORIGIN}/api/desktop-auth/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15000)
      });
      const created = await request('requests', { challenge });
      if (created.status === 404 || created.status === 503) throw new Error('서버에 PC 앱 웹 로그인 기능이 아직 적용되지 않았습니다.');
      if (created.status !== 200) throw new Error('로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      const intent = await created.json();
      if (!/^[A-Za-z0-9_-]{43}$/.test(intent?.requestId) || !Number.isSafeInteger(intent.expiresIn) || intent.expiresIn <= 0 || intent.expiresIn > 300000)
        throw new Error('유효한 로그인 요청을 확인하지 못했습니다.');
      const deadline = now() + intent.expiresIn;
      await openExternal(`${REMOTE_ORIGIN}/api/desktop-auth/authorize?requestId=${intent.requestId}`);
      // The verifier stays in the native process, never in a URL, renderer, or log.
      while (now() < deadline) {
        await sleep(2000);
        if (now() >= deadline) break;
        const result = await request('exchange', { requestId: intent.requestId, verifier });
        if (result.status === 200) { await completed(); return { ok: true }; }
        if (result.status !== 202) throw new Error('로그인 요청이 만료되었거나 취소되었습니다. 다시 시도해 주세요.');
      }
      throw new Error('로그인 요청이 만료되었습니다. PC 앱에서 다시 로그인해 주세요.');
    } catch (error) {
      // Never surface native fetch errors that can contain request URLs or credentials.
      if (error instanceof Error && /^(웹브라우저에서|서버에 PC 앱|로그인을 시작|유효한 로그인|로그인 요청)/.test(error.message)) throw error;
      throw new Error('웹 로그인을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally { pending = false; }
  }
  return { start, pending: () => pending };
}
module.exports = { createWebLogin };
