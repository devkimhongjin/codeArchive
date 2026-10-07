import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function masterReleaseSource({ cwd = process.cwd(), event = process.env.GITHUB_EVENT_NAME, ref = process.env.GITHUB_REF, sha = process.env.GITHUB_SHA, kind } = {}) {
  if (!['desktop', 'extension'].includes(kind)) throw new Error('Unknown release kind.');
  const manual = event === 'workflow_dispatch' && ref === 'refs/heads/master';
  const tagged = event === 'push' && new RegExp(`^refs/tags/${kind}-v\\d+\\.\\d+\\.\\d+$`).test(ref ?? '');
  if (!manual && !tagged) throw new Error('Releases require a master workflow dispatch or a release tag on master.');
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('A full release commit SHA is required.');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (commit !== sha) throw new Error('Checked-out source differs from the requested release commit.');
  if (tagged && git(['rev-parse', `${ref}^{commit}`]) !== commit) throw new Error('Release tag differs from the checked-out source.');
  const history = git(['log', '--first-parent', '--format=%H', 'refs/remotes/origin/master']).split('\n');
  if (!history.includes(commit)) throw new Error('Release commit is not on the master first-parent history.');
  return { branch: 'master', commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = masterReleaseSource({ kind: process.argv[2] });
  process.stdout.write(`MASTER_RELEASE_OK ${source.commit}\n`);
}
