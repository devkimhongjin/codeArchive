const { once } = require('node:events');
const { writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { WebSocket } = require('ws');
const { createHmac } = require('node:crypto');
const { EXTENSION_ID } = require('../src/policy.cjs');
async function run({ app, mainWindow, bridge, bridgePort }) {
  const directory = process.env.CODEARCHIVE_DESKTOP_SMOKE_OUTPUT;
  const checks = {};
  const timer = setTimeout(() => app.exit(1), 30000);
  let client;
  try {
    const status = await mainWindow.webContents.executeJavaScript('window.codeArchiveDesktop.getStatus()');
    checks.preloadAndMainIpc = status.version === '0.1.0' && status.connected === false;
    checks.noNodeInRenderer = await mainWindow.webContents.executeJavaScript("typeof window.require === 'undefined' && typeof window.process === 'undefined'");
    const pair = await mainWindow.webContents.executeJavaScript('window.codeArchiveDesktop.pair()');
    const origin = `chrome-extension://${EXTENSION_ID}`;
    const response = await fetch(`http://127.0.0.1:${bridgePort}/pair`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pair.code }) });
    const { token } = await response.json();
    client = new WebSocket(`ws://127.0.0.1:${bridgePort}/bridge`, { origin });
    const challengeResponse = once(client, 'message');
    await once(client, 'open');
    client.send(JSON.stringify({ type: 'HELLO', nonce: 'd'.repeat(64) }));
    const challenge = JSON.parse((await challengeResponse)[0]);
    const ready = once(client, 'message');
    client.send(JSON.stringify({ type: 'AUTH', proof: createHmac('sha256', token).update(`client:${challenge.clientNonce}:${challenge.nonce}`).digest('hex') })); await ready;
    client.on('message', data => {
      const request = JSON.parse(data);
      if (request.type !== 'REQUEST') return;
      const response = request.message.type === 'CONNECT' ? { capability: 'fixture-capability', expiresAt: Date.now() + 60000, version: '0.3.0', features: ['history-v1'] } : request.message.type === 'GET_STATUS' ? { pendingCount: 0 } : request.message.type === 'GET_LOCAL_ARCHIVE' ? { captures: [], localOnly: true, hasMore: false } : { ok: true };
      client.send(JSON.stringify({ type: 'RESPONSE', id: request.id, response }));
    });
    checks.loopbackPaired = bridge.connected();
    const connection = await mainWindow.webContents.executeJavaScript("window.codeArchiveDesktop.requestBridge({type:'CONNECT'})");
    checks.nativeBridge = connection.version === '0.3.0';
    const providers = await mainWindow.webContents.executeJavaScript("window.codeArchiveDesktop.api({path:'/api/auth/providers',method:'GET',headers:{}})");
    checks.realApiRead = providers.status === 200 && typeof JSON.parse(providers.body).github.enabled === 'boolean';
    await mainWindow.webContents.executeJavaScript("history.replaceState(null,'','?view=settings'); window.dispatchEvent(new PopStateEvent('popstate'))");
    await new Promise(resolve => setTimeout(resolve, 2500));
    checks.renderedSettings = await mainWindow.webContents.executeJavaScript("document.body.textContent.includes('PC 앱 설정') && document.body.textContent.includes('Windows 로그인 시 자동 시작')");
    if (directory) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'desktop-smoke.json'), JSON.stringify(checks, null, 2));
      try { await writeFile(path.join(directory, 'desktop-smoke.png'), (await mainWindow.webContents.capturePage({ stayAwake: true })).toPNG()); }
      catch { console.log('Optional app screenshot unavailable; functional checks are saved separately.'); }
    }
    console.log(JSON.stringify({ test: 'owned Electron app smoke with synthetic extension peer (not real Chrome)', checks }));
    app.exit(Object.values(checks).every(Boolean) ? 0 : 1);
  } catch (error) { console.error('Desktop smoke failed:', error.message); app.exit(1); }
  finally { clearTimeout(timer); client?.terminate(); }
}
module.exports = { run };
