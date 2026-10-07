const { access, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function createAutostartPolicy({ statePath, legacyPaths, packaged, platform, getSettings, setSettings }) {
  const supported = packaged && platform === 'win32';
  async function markInitialized() {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ initialized: true }));
  }
  return {
    async initialize() {
      if (!supported || await exists(statePath)) return;
      // Existing installs may have an explicit OFF in Windows. Preserve it even
      // though older app versions did not keep an initialization marker.
      const existingInstall = (await Promise.all(legacyPaths.map(exists))).some(Boolean);
      const alreadyEnabled = getSettings().openAtLogin === true;
      await markInitialized();
      if (!existingInstall && !alreadyEnabled) setSettings(true);
    },
    async setEnabled(value) {
      if (typeof value !== 'boolean' || !supported) throw new Error('자동 시작은 설치한 Windows 앱에서 설정할 수 있습니다.');
      await markInitialized();
      setSettings(value);
      return { ok: true };
    },
  };
}
module.exports = { createAutostartPolicy };
