const { app, BrowserWindow, ipcMain, protocol, net, session, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createExtensionServer } = require('./extension-server.cjs');
const { createUpdater, runInstaller } = require('./updater.cjs');
const { REMOTE_ORIGIN, APP_URL, BRIDGE_PORT, apiRequest, trustedRenderer, authUrl, externalUrl } = require('./policy.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'codearchive', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let mainWindow, authWindow, tray, bridge, updater, quitting = false, activeRequests = 0;
const loginItemOptions = { path: process.execPath, args: ['--autostart'] };
if (process.env.CODEARCHIVE_DESKTOP_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.CODEARCHIVE_DESKTOP_TEST_USER_DATA));
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(start).catch(() => { require('electron').dialog.showErrorBox('CodeArchive', 'PC 앱을 시작하지 못했습니다. 다른 CodeArchive 앱이 실행 중인지 확인해 주세요.'); app.quit(); });
}
async function start() {
  if (process.platform === 'win32') app.setAppUserModelId('io.github.devkimhongjin.codearchive');
  const userData = app.getPath('userData');
  const tokenPath = path.join(userData, 'extension-pair.bin');
  async function saveToken(value) {
    if (value === null) { await require('node:fs/promises').unlink(tokenPath).catch(() => {}); return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
    await mkdir(userData, { recursive: true }); await writeFile(tokenPath, safeStorage.encryptString(value));
  }
  let token = null;
  try { if (safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(await readFile(tokenPath)); } catch { /* First launch or a revoked Windows key starts unpaired. */ }
  const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
  bridge = createExtensionServer({ token, saveToken, port: smoke ? 0 : BRIDGE_PORT, onStatus: connected => console.log(JSON.stringify({ event: 'desktop-extension-connection', connected })) });
  const bridgePort = await bridge.listen();
  updater = createUpdater({ version: app.getVersion(), publicKeyPath: path.join(__dirname, 'update-public-key.pem'), directory: path.join(userData, 'updates') });
  const assets = path.resolve(__dirname, '../renderer');
  protocol.handle('codearchive', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(assets, relative);
    if (file !== assets && !file.startsWith(`${assets}${path.sep}`)) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' https://api.github.com; object-src 'none'; frame-src 'none'; base-uri 'none'");
    return new Response(response.body, { status: response.status, headers });
  });
  const apiSession = session.fromPartition('persist:codearchive-account');
  apiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow = new BrowserWindow({ width: 1360, height: 900, minWidth: 900, minHeight: 620, show: !process.argv.includes('--autostart'), title: 'CodeArchive', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) { event.preventDefault(); openExternal(url); } });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  function expose(channel, action) { ipcMain.handle(channel, async (event, ...args) => { if (!trustedRenderer(event.senderFrame, mainWindow.webContents)) throw new Error('허용되지 않은 앱 요청입니다.'); return action(...args); }); }
  expose('desktop:bridge', async message => { activeRequests++; try { return await bridge.request(message); } finally { activeRequests--; } });
  expose('desktop:api', async input => {
    const request = apiRequest(input); activeRequests++;
    try {
      const response = await apiSession.fetch(request.url, { method: request.method, headers: request.headers, body: request.body, credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(30000) });
      return { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? '' }, body: await response.text() };
    } finally { activeRequests--; }
  });
  expose('desktop:login', value => { openAuth(authUrl(value)); return { ok: true }; });
  expose('desktop:status', () => ({ version: app.getVersion(), connected: bridge.connected(), autostart: app.isPackaged && app.getLoginItemSettings(loginItemOptions).openAtLogin, packaged: app.isPackaged, update: updater.status() }));
  expose('desktop:pair', () => bridge.createPairCode());
  expose('desktop:disconnect', async () => { await bridge.disconnect(); return { ok: true }; });
  expose('desktop:autostart', value => { if (typeof value !== 'boolean' || !app.isPackaged) throw new Error('자동 시작은 설치한 앱에서 설정할 수 있습니다.'); app.setLoginItemSettings({ ...loginItemOptions, openAtLogin: value }); return { ok: true }; });
  expose('desktop:update-check', () => updater.check());
  expose('desktop:update-install', async () => {
    if (!app.isPackaged || activeRequests > 0) throw new Error('진행 중인 작업을 마친 뒤 설치한 앱에서 업데이트해 주세요.');
    const installer = await updater.download();
    if (activeRequests > 0) throw new Error('작업이 진행 중입니다. 작업을 마친 뒤 다시 시도해 주세요.');
    await runInstaller(installer); quitting = true; app.quit(); return { ok: true };
  });
  function openAuth(url) {
    if (authWindow && !authWindow.isDestroyed()) { authWindow.focus(); return; }
    authWindow = new BrowserWindow({ parent: mainWindow, width: 700, height: 820, title: 'CodeArchive · GitHub 로그인', webPreferences: { partition: 'persist:codearchive-account', sandbox: true, nodeIntegration: false, contextIsolation: true } });
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    authWindow.webContents.on('will-navigate', (event, target) => { const next = new URL(target); if (!['https://github.com', REMOTE_ORIGIN].includes(next.origin)) event.preventDefault(); });
    const finish = (_event, target) => {
      const destination = new URL(target);
      if (destination.origin === REMOTE_ORIGIN && destination.pathname === '/') {
        authWindow?.close(); mainWindow.loadURL(`${APP_URL}${destination.search}`); mainWindow.show(); mainWindow.focus();
      }
    };
    authWindow.webContents.on('did-navigate', finish);
    authWindow.on('closed', () => { authWindow = null; });
    authWindow.loadURL(url);
  }
  function openExternal(value) { try { const url = externalUrl(value); if (/^https:\/\/github.com\/apps\/[\w-]+\/installations\/new/.test(url)) openAuth(authUrl(url)); else void shell.openExternal(url); } catch { /* Reject unsupported protocols and destinations. */ } }
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('CodeArchive'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '대시보드 열기', click: () => { mainWindow.show(); mainWindow.focus(); } }, { label: '종료', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  await mainWindow.loadURL(APP_URL);
  if (smoke) await require('../test/smoke-driver.cjs').run({ app, mainWindow, bridge, bridgePort });
  if (app.isPackaged) { void updater.check(); const timer = setInterval(() => void updater.check(), 6 * 60 * 60 * 1000); timer.unref(); }
}
app.on('before-quit', () => { quitting = true; void bridge?.close(); });
