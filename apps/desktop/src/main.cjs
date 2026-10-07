const { app, BrowserWindow, ipcMain, protocol, net, session, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createExtensionServer } = require('./extension-server.cjs');
const { createUpdater, runInstaller } = require('./updater.cjs');
const { createSetup } = require('./setup.cjs');
const { createUpdatePolicy } = require('./update-policy.cjs');
const { createAutostartPolicy } = require('./autostart-policy.cjs');
const { createWebLogin } = require('./web-login.cjs');
const { REMOTE_ORIGIN, APP_URL, BRIDGE_PORT, apiRequest, trustedRenderer, authUrl, externalUrl } = require('./policy.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'codearchive', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let mainWindow, tray, bridge, updater, webLogin, quitting = false, activeRequests = 0;
const loginItemOptions = { path: process.execPath, args: ['--autostart'] };
if (process.env.CODEARCHIVE_DESKTOP_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.CODEARCHIVE_DESKTOP_TEST_USER_DATA));
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', (_event, argv) => {
    mainWindow?.show(); mainWindow?.focus();
    const callback = argv.find(value => value.startsWith('codearchive://auth/'));
    if (callback && webLogin) void webLogin.receiveCompletion(callback);
  });
  app.whenReady().then(start).catch(() => { require('electron').dialog.showErrorBox('CodeArchive', 'PC 앱을 시작하지 못했습니다. 다른 CodeArchive 앱이 실행 중인지 확인해 주세요.'); app.quit(); });
}
async function start() {
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') {
    app.setAppUserModelId('io.github.devkimhongjin.codearchive');
    if (app.isPackaged && !app.isDefaultProtocolClient('codearchive')) app.setAsDefaultProtocolClient('codearchive');
  }
  const userData = app.getPath('userData');
  const autostart = createAutostartPolicy({
    statePath: path.join(userData, 'autostart-initialized.json'),
    legacyPaths: ['setup.json', 'extension-pair.bin', 'update-settings.json', 'Preferences'].map(file => path.join(userData, file)),
    packaged: app.isPackaged, platform: process.platform,
    getSettings: () => app.getLoginItemSettings(loginItemOptions),
    setSettings: value => app.setLoginItemSettings({ ...loginItemOptions, openAtLogin: value }),
  });
  await autostart.initialize().catch(() => { /* Preserve Windows state if initialization cannot be recorded. */ });
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
  const setup = createSetup({ extensionPath: app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '../bundled-extension'), statePath: path.join(userData, 'setup.json'), connected: () => bridge.connected(), openFolder: value => shell.openPath(value) });
  updater = createUpdater({ version: app.getVersion(), publicKeyPath: path.join(__dirname, 'update-public-key.pem'), directory: path.join(userData, 'updates') });
  const updatePolicy = createUpdatePolicy({ statePath: path.join(userData, 'update-settings.json'), updater, packaged: app.isPackaged, visible: () => !mainWindow || mainWindow.isVisible(), active: () => activeRequests > 0 || webLogin?.pending(), install: async installer => { await runInstaller(installer); quitting = true; app.quit(); } });
  await updatePolicy.load();
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
  webLogin = createWebLogin({ fetch: (...args) => apiSession.fetch(...args), openExternal: url => shell.openExternal(url), completed: async () => {
    await mainWindow.loadURL(APP_URL); mainWindow.show(); mainWindow.focus();
  } });
  mainWindow = new BrowserWindow({ width: 1360, height: 900, minWidth: 900, minHeight: 620, show: !process.argv.includes('--autostart'), title: 'CodeArchive', icon: path.join(__dirname, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) { event.preventDefault(); openExternal(url); } });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  function expose(channel, action) { ipcMain.handle(channel, async (event, ...args) => { if (!trustedRenderer(event.senderFrame, mainWindow.webContents)) throw new Error('허용되지 않은 앱 요청입니다.'); if (updatePolicy.installing() && ['desktop:bridge', 'desktop:api', 'desktop:login'].includes(channel)) throw new Error('업데이트 중입니다. 잠시 후 다시 시도해 주세요.'); return action(...args); }); }
  expose('desktop:bridge', async message => { const work = !['GET_STATUS', 'CONNECT'].includes(message?.type); if (work) updatePolicy.touch(); activeRequests++; try { return await bridge.request(message); } finally { activeRequests--; if (work) updatePolicy.touch(); } });
  expose('desktop:api', async input => {
    const request = apiRequest(input);
    if (webLogin.pending() && !['GET', 'HEAD'].includes(request.method)) throw new Error('웹 로그인을 마친 뒤 다시 시도해 주세요.');
    const work = !['GET', 'HEAD'].includes(request.method); if (work) updatePolicy.touch(); activeRequests++;
    try {
      const response = await apiSession.fetch(request.url, { method: request.method, headers: request.headers, body: request.body, credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(30000) });
      return { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? '' }, body: await response.text() };
    } finally { activeRequests--; if (work) updatePolicy.touch(); }
  });
  expose('desktop:login', async value => {
    const target = authUrl(value);
    if (new URL(target).origin === 'https://github.com') return openInstallation();
    updatePolicy.touch(); activeRequests++;
    try { return await webLogin.start(); } finally { activeRequests--; updatePolicy.touch(); }
  });
  expose('desktop:status', () => ({ version: app.getVersion(), connected: bridge.connected(), autostart: app.isPackaged && app.getLoginItemSettings(loginItemOptions).openAtLogin, packaged: app.isPackaged, autoUpdate: updatePolicy.enabled(), update: updater.status() }));
  expose('desktop:pair', () => bridge.createPairCode());
  expose('desktop:setup', () => setup.get());
  expose('desktop:extension-folder', () => setup.openFolder());
  expose('desktop:setup-complete', () => setup.complete());
  expose('desktop:disconnect', async () => { await bridge.disconnect(); return { ok: true }; });
  expose('desktop:autostart', value => autostart.setEnabled(value));
  expose('desktop:update-check', () => updater.check());
  expose('desktop:update-install', () => updatePolicy.apply());
  expose('desktop:auto-update', value => updatePolicy.setEnabled(value));
  expose('desktop:activity', value => updatePolicy.report(value));
  async function openInstallation() {
    if (webLogin.pending()) throw new Error('웹 로그인을 마친 뒤 다시 시도해 주세요.');
    const response = await apiSession.fetch(`${REMOTE_ORIGIN}/api/auth/me`, { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) throw new Error('PC 앱에 다시 로그인한 뒤 GitHub 연결을 시도해 주세요.');
    const account = await response.json();
    if (typeof account.githubId !== 'string' || !/^[0-9]{1,64}$/.test(account.githubId)) throw new Error('GitHub 계정을 확인하지 못했습니다.');
    await shell.openExternal(`${REMOTE_ORIGIN}/api/desktop-auth/install?githubId=${account.githubId}`);
    return { ok: true };
  }
  function openExternal(value) { try { const url = externalUrl(value); if (/^https:\/\/github.com\/apps\/[\w-]+\/installations\/new/.test(url)) void openInstallation().catch(() => {}); else void shell.openExternal(url); } catch { /* Reject unsupported protocols and destinations. */ } }
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('CodeArchive'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '대시보드 열기', click: () => { mainWindow.show(); mainWindow.focus(); } }, { label: '종료', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  await mainWindow.loadURL(APP_URL);
  if (smoke) await require('../test/smoke-driver.cjs').run({ app, mainWindow, bridge, bridgePort, apiSession, updater });
  if (app.isPackaged) { const idleTimer = setInterval(() => void updatePolicy.tick(), 5000); idleTimer.unref(); void updater.check(); const timer = setInterval(() => void updater.check(), 6 * 60 * 60 * 1000); timer.unref(); }
}
app.on('before-quit', () => { quitting = true; void bridge?.close(); });
