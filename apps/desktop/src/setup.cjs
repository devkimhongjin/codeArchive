const { readFile, writeFile, mkdir, rename } = require('node:fs/promises');
const path = require('node:path');
function createSetup({ extensionPath, statePath, connected, openFolder }) {
  return {
    async get() {
      let extensionVersion = null, completed = false;
      try { const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8')); if (manifest.name === 'CodeArchive' && /^\d+\.\d+\.\d+$/.test(manifest.version)) extensionVersion = manifest.version; } catch { /* Report missing bundle in the guide. */ }
      try { completed = JSON.parse(await readFile(statePath, 'utf8')).completed === true; } catch { /* First run starts with the guide. */ }
      return { extensionPath, extensionVersion, available: extensionVersion !== null, completed };
    },
    async openFolder() {
      if (!(await this.get()).available) throw new Error('포함된 확장 파일을 찾을 수 없습니다. 앱을 다시 설치해 주세요.');
      const error = await openFolder(extensionPath);
      if (error) throw new Error('확장 폴더를 열지 못했습니다. 표시된 경로를 복사해 주세요.');
      return { ok: true };
    },
    async complete() {
      if (!connected()) throw new Error('확장 연결을 완료한 뒤 다시 시도해 주세요.');
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(`${statePath}.tmp`, JSON.stringify({ completed: true }));
      await rename(`${statePath}.tmp`, statePath);
      return { ok: true };
    }
  };
}
module.exports = { createSetup };
