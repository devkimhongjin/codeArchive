import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const directory of ['../dashboard/', '../extension/']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: fileURLToPath(new URL(directory, import.meta.url)), stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, CODEARCHIVE_SKIP_INSTALLED_EXTENSION: 'true' }
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
await mkdir(new URL('./renderer/', import.meta.url), { recursive: true });
await cp(new URL('../dashboard/dist/', import.meta.url), new URL('./renderer/', import.meta.url), { recursive: true });
// Fixed output under this package; never delete or replace the user's Chrome installation.
const extensionOutput = new URL('./bundled-extension/', import.meta.url);
await rm(extensionOutput, { recursive: true, force: true });
await cp(new URL('../extension/dist/', import.meta.url), extensionOutput, { recursive: true });
