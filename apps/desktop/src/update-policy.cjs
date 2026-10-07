const { readFile, mkdir, writeFile, rename } = require('node:fs/promises');
const path = require('node:path');
function createUpdatePolicy({ statePath, updater, packaged, visible, active, install, now = Date.now, idleMs = 60000 }) {
  let enabled = false, applying = false, installing = false, heartbeat = null, lastWork = now(), settingsWrite = Promise.resolve();
  const busy = () => active() || !heartbeat || now() - heartbeat.at > 10000 || heartbeat.busy;
  const eligible = () => packaged && enabled && !visible() && !busy() && !heartbeat.draft && now() - lastWork >= idleMs;
  return {
    async load() { try { enabled = JSON.parse(await readFile(statePath, 'utf8')).autoUpdate === true; } catch { enabled = false; } },
    enabled: () => enabled,
    applying: () => applying,
    installing: () => installing,
    report(value) {
      if (!value || typeof value.busy !== 'boolean' || typeof value.draft !== 'boolean') throw new Error('앱 작업 상태가 올바르지 않습니다.');
      heartbeat = { ...value, at: now() }; if (value.busy || value.draft) lastWork = now();
    },
    touch() { lastWork = now(); },
    async setEnabled(value) {
      if (typeof value !== 'boolean' || !packaged) throw new Error('자동 업데이트는 설치한 앱에서 설정할 수 있습니다.');
      const write = settingsWrite.then(async () => {
        await mkdir(path.dirname(statePath), { recursive: true });
        await writeFile(`${statePath}.tmp`, JSON.stringify({ autoUpdate: value }));
        await rename(`${statePath}.tmp`, statePath); enabled = value; return { ok: true };
      });
      settingsWrite = write.catch(() => {}); return write;
    },
    async apply(automatic = false) {
      if (applying || !packaged || busy() || (automatic && !eligible())) throw new Error('진행 중인 작업을 마친 뒤 업데이트해 주세요.');
      applying = true;
      try {
        const installer = await updater.download();
        if (busy() || (automatic && !eligible())) { updater.defer(); throw new Error('작업 또는 설정이 변경되어 업데이트 적용을 보류했습니다.'); }
        installing = true; await install(installer); return { ok: true };
      } finally { applying = false; installing = false; }
    },
    async tick() {
      if (!applying && ['available', 'ready'].includes(updater.status().state) && eligible()) { try { await this.apply(true); } catch { /* Keep the verified release available for a later idle retry or manual apply. */ } }
    }
  };
}
module.exports = { createUpdatePolicy };
