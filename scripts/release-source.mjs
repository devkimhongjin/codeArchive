import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function developPromotionSource(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.PROMOTION_REPOSITORY ?? '')
      || env.PROMOTION_HEAD_REPOSITORY !== env.PROMOTION_REPOSITORY
      || env.PROMOTION_BASE_REPOSITORY !== env.PROMOTION_REPOSITORY
      || env.PROMOTION_HEAD_REF !== 'develop' || env.PROMOTION_BASE_REF !== 'master') {
    throw new Error('Master promotion requires a same-repository develop → master pull request.');
  }
  return { repository: env.PROMOTION_REPOSITORY, head: 'develop', base: 'master' };
}

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
  if (process.argv[2] === 'promotion') {
    developPromotionSource();
    process.stdout.write('DEVELOP_PROMOTION_OK\n');
  } else {
    const source = masterReleaseSource({ kind: process.argv[2] });
    process.stdout.write(`MASTER_RELEASE_OK ${source.commit}\n`);
  }
}
