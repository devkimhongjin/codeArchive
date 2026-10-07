const { verify, createHash } = require('node:crypto');
const { readFile, mkdir, open, rename, unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const REPO = 'https://github.com/devkimhongjin/codeArchive';
function versionTuple(value) { if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('업데이트 버전이 올바르지 않습니다.'); return value.split('.').map(Number); }
function isNewer(next, current) { const a = versionTuple(next), b = versionTuple(current); for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return false; }
function validateManifest(envelope, publicKey, current) {
  if (!envelope || typeof envelope.signature !== 'string' || !envelope.manifest || !verify(null, Buffer.from(JSON.stringify(envelope.manifest)), publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('업데이트 서명을 확인하지 못했습니다.');
  const value = envelope.manifest;
  if (value.source?.branch !== 'master' || !/^[a-f0-9]{40}$/.test(value.source?.commit)) throw new Error('master 릴리스 출처를 확인하지 못했습니다.');
  if (!isNewer(value.version, current)) return null;
  if (value.artifact?.url !== `${REPO}/releases/download/desktop-v${value.version}/CodeArchive-Setup-${value.version}.exe` || !/^[a-f0-9]{64}$/.test(value.artifact?.sha256)) throw new Error('업데이트 파일 정보가 올바르지 않습니다.');
  return value;
}
function createUpdater({ version, publicKeyPath, directory, fetcher = fetch }) {
  let manifest = null, status = { state: 'idle', version: null, message: '새 버전을 확인할 수 있습니다.' }, busy = false;
  return {
    status: () => ({ ...status }),
    async check() {
      if (busy) return { ...status };
      busy = true; manifest = null; status = { state: 'checking', version: null, message: '새 버전 확인 중…' };
      try {
        const response = await fetcher('https://api.github.com/repos/devkimhongjin/codeArchive/releases?per_page=50', { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) throw new Error('릴리스 목록을 가져오지 못했습니다.');
        const releases = await response.json();
        if (!Array.isArray(releases)) throw new Error('릴리스 목록이 올바르지 않습니다.');
        const release = releases.filter(item => !item.draft && !item.prerelease && /^desktop-v\d+\.\d+\.\d+$/.test(item.tag_name) && isNewer(item.tag_name.slice(9), version)).sort((a, b) => isNewer(a.tag_name.slice(9), b.tag_name.slice(9)) ? -1 : 1)[0];
        if (!release) { status = { state: 'current', version: null, message: '최신 버전입니다.' }; return { ...status }; }
        const url = `${REPO}/releases/download/${release.tag_name}/codearchive-desktop-update.json`;
        const metadata = await fetcher(url, { signal: AbortSignal.timeout(15000) });
        if (!metadata.ok || Number(metadata.headers.get('content-length')) > 65536) throw new Error('업데이트 정보를 가져오지 못했습니다.');
        const text = await metadata.text();
        if (text.length > 65536) throw new Error('업데이트 정보가 너무 큽니다.');
        manifest = validateManifest(JSON.parse(text), await readFile(publicKeyPath), version);
        if (!manifest || `desktop-v${manifest.version}` !== release.tag_name) throw new Error('업데이트 버전이 일치하지 않습니다.');
        status = { state: 'available', version: manifest.version, message: `v${manifest.version} 업데이트가 있습니다.` };
      } catch { manifest = null; status = { state: 'error', version: null, message: '업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }; }
      finally { busy = false; }
      return { ...status };
    },
    async download() {
      if (busy || !manifest) throw new Error('새 버전 확인 후 다시 시도해 주세요.');
      busy = true; const selected = manifest;
      const destination = join(directory, `CodeArchive-Setup-${selected.version}.exe`), temporary = `${destination}.part`;
      status = { state: 'downloading', version: selected.version, message: '업데이트 다운로드 중…' };
      let file;
      try {
        await mkdir(directory, { recursive: true });
        const response = await fetcher(selected.artifact.url, { signal: AbortSignal.timeout(300000) });
        if (!response.ok || !response.body) throw new Error('업데이트 다운로드 실패');
        file = await open(temporary, 'w'); const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 300 * 1024 * 1024) throw new Error('업데이트 크기 초과'); hash.update(chunk); await file.write(chunk); }
        await file.close(); file = null;
        if (hash.digest('hex') !== selected.artifact.sha256) throw new Error('업데이트 체크섬 불일치');
        await rename(temporary, destination);
        status = { state: 'ready', version: selected.version, message: '업데이트를 적용하고 앱을 다시 시작합니다.' };
        return destination;
      } catch { await file?.close(); await unlink(temporary).catch(() => {}); status = { state: 'error', version: selected.version, message: '다운로드 파일을 검증하지 못했습니다. 다시 확인해 주세요.' }; throw new Error(status.message); }
      finally { busy = false; }
    }
  };
}
function runInstaller(path, spawnInstaller = spawn) { const child = spawnInstaller(path, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true, shell: false }); child.unref(); return new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); }
module.exports = { createUpdater, validateManifest, isNewer, runInstaller };
