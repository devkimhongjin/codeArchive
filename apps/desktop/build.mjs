import { cp, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dashboard = fileURLToPath(new URL('../dashboard/', import.meta.url));
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: dashboard, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status || 1);
await mkdir(new URL('./renderer/', import.meta.url), { recursive: true });
await cp(new URL('../dashboard/dist/', import.meta.url), new URL('./renderer/', import.meta.url), { recursive: true });
