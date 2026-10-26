import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSiteRows, problemStates, SiteSyncService, type ServerSolution } from '../src/siteSync';
import { createCapture } from '../src/capture';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const solution = (patch: Partial<ServerSolution>): ServerSolution => ({ captureId: id(1), platform: 'JUNGOL', historicalSubmissionId: null,
  problemNumber: '1000', language: 'Java', solvedAt: '2026-10-21T01:00:00.000Z', state: 'NONE', ...patch });

test('rows match the same site submission, or exactly one close live capture of the same problem and language', () => {
  const solutions = [
    solution({ captureId: id(1), historicalSubmissionId: '501', state: 'SUCCEEDED' }),
    solution({ captureId: id(2), problemNumber: '2000', solvedAt: '2026-10-21T01:00:30.000Z' }),
    solution({ captureId: id(3), problemNumber: '3000', solvedAt: '2026-10-21T01:00:00.000Z' }),
    solution({ captureId: id(4), problemNumber: '3000', solvedAt: '2026-10-21T01:01:00.000Z' }),
    solution({ captureId: id(5), platform: 'SWEA', historicalSubmissionId: '502' })
  ];
  assert.deepEqual(matchSiteRows('JUNGOL', [
    { submissionId: '501', problemNumber: '1000' },
    { submissionId: '502', problemNumber: '1000', language: 'Java 8', solvedAt: '2026-10-21T05:00:00.000Z' },
    { submissionId: '503', problemNumber: '2000', language: 'Java 8', solvedAt: '2026-10-21T01:01:00.000Z' },
    { submissionId: '504', problemNumber: '2000', language: 'Java 8', solvedAt: '2026-10-21T01:05:00.000Z' },
    { submissionId: '505', problemNumber: '2000', language: 'Python 3', solvedAt: '2026-10-21T01:00:30.000Z' },
    { submissionId: '506', problemNumber: '3000', language: 'Java', solvedAt: '2026-10-21T01:00:30.000Z' },
    { submissionId: '507', problemNumber: '2000', language: 'Java' }
  ], solutions), [
    { submissionId: '501', state: 'REGISTERED', captureId: id(1), commit: 'SUCCEEDED' },
    { submissionId: '502', state: 'UNREGISTERED' },
    { submissionId: '503', state: 'REGISTERED', captureId: id(2), commit: 'NONE' },
    { submissionId: '504', state: 'UNREGISTERED' },
    { submissionId: '505', state: 'UNREGISTERED' },
    { submissionId: '506', state: 'AMBIGUOUS' },
    { submissionId: '507', state: 'UNREGISTERED' }
  ]);
  assert.deepEqual(problemStates('JUNGOL', ['1000', '3000', '9'], [...solutions, solution({ captureId: id(6), problemNumber: '3000', historicalSubmissionId: '9', state: 'FAILED' })]), [
    { problemNumber: '1000', registered: 1, uncommitted: [] },
    { problemNumber: '3000', registered: 3, uncommitted: [id(3), id(4), id(6)] },
    { problemNumber: '9', registered: 0, uncommitted: [] }
  ]);
});

test('a live capture is one submission: of several close submissions only the closest matches it', () => {
  const live = solution({ captureId: id(7), platform: 'PROGRAMMERS', problemNumber: '159993', language: 'Java', solvedAt: '2026-10-20T03:00:10.000Z' });
  const rows = ['00', '01', '02'].map(second => ({ submissionId: `pg:947840:159993:2026-10-20T12:00:${second}.000+09:00:java`, problemNumber: '159993', language: 'java',
    solvedAt: `2026-10-20T12:00:${second}.000+09:00` }));
  assert.deepEqual(matchSiteRows('PROGRAMMERS', rows, [live]).map(row => row.state), ['UNREGISTERED', 'UNREGISTERED', 'REGISTERED']);
  // Two submissions equally close cannot be told apart.
  const tied = [rows[0]!, { ...rows[2]!, solvedAt: '2026-10-20T12:00:20.000+09:00' }];
  assert.deepEqual(matchSiteRows('PROGRAMMERS', tied, [live]).map(row => row.state), ['AMBIGUOUS', 'AMBIGUOUS']);
});

function server(solutions: ServerSolution[], settings: Record<string, unknown> | null, user = { id: 7, githubId: '70' }) {
  const posts: Array<{ path: string; body: unknown }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); posts.push({ path, body });
      if (path === '/api/solutions/bulk') return Response.json({ acceptedCaptureIds: body.captures.map((capture: { captureId: string }) => capture.captureId) });
      if (path === '/api/solutions/github-batch') return Response.json(Object.fromEntries(body.captureIds.map((captureId: string) => [captureId, 'PENDING'])));
    }
    if (path === '/api/auth/me') return Response.json(user);
    if (path === '/api/auth/csrf') return Response.json({ headerName: 'X-XSRF-TOKEN', token: 't' });
    if (path === '/api/solutions/github-candidates') return Response.json(solutions);
    if (path === '/api/settings') return settings ? Response.json(settings) : new Response('', { status: 404 });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { posts, fetcher };
}
const target = { version: 3, githubInstallationId: 11, githubOwner: 'me', githubRepository: 'archive', githubBranch: 'main' };
const capture = (submissionId: string, solvedAt: string) => createCapture({ platform: 'JUNGOL', problemNumber: '2000', title: 'Fixture', problemUrl: 'https://jungol.co.kr/problem/2000',
  language: 'Java 8', sourceCode: 'class X {}', result: 'ACCEPTED', solvedAt, historicalImport: true, historicalSubmissionId: submissionId })!;

test('status reports the extension account only, and whether a GitHub target is configured', async () => {
  const fake = server([solution({ historicalSubmissionId: '501' })], target);
  const service = new SiteSyncService({ accountId: async () => '7', fetcher: fake.fetcher });
  const status = await service.status('JUNGOL', [{ submissionId: '501', problemNumber: '1000' }]);
  assert.equal(status.ok && status.githubReady, true);
  assert.equal(status.ok && status.rows[0]!.state, 'REGISTERED');
  assert.deepEqual(await new SiteSyncService({ accountId: async () => '8', fetcher: fake.fetcher }).status('JUNGOL', []), { ok: false, error: 'ACCOUNT_CHANGED' });
  assert.deepEqual(await new SiteSyncService({ accountId: async () => undefined, fetcher: fake.fetcher }).status('JUNGOL', []), { ok: false, error: 'LOGIN_REQUIRED' });
  const noTarget = await new SiteSyncService({ accountId: async () => '7', fetcher: server([], { version: 3 }).fetcher }).status('JUNGOL', []);
  assert.equal(noTarget.ok && noTarget.githubReady, false);
});

test('register posts only a new submission and never duplicates a live capture of the same submission', async () => {
  const live = solution({ captureId: id(2), problemNumber: '2000', solvedAt: '2026-10-21T01:00:20.000Z' });
  const fake = server([live, solution({ captureId: id(3), historicalSubmissionId: '600', problemNumber: '2000' })], target);
  const service = new SiteSyncService({ accountId: async () => '7', fetcher: fake.fetcher });
  assert.deepEqual(await service.register(capture('600', '2026-10-20T00:00:00.000Z')), { ok: true, created: false, captureId: id(3) });
  assert.deepEqual(await service.register(capture('601', '2026-10-21T01:00:00.000Z')), { ok: true, created: false, captureId: id(2) }, 'the live capture is the same submission');
  assert.equal(fake.posts.length, 0);
  const fresh = capture('602', '2026-10-22T09:00:00.000Z');
  assert.deepEqual(await service.register(fresh), { ok: true, created: true, captureId: fresh.captureId });
  assert.deepEqual(fake.posts.map(post => post.path), ['/api/solutions/bulk']);
  assert.deepEqual(await service.register({ ...fresh, historicalImport: false }), { ok: false, error: 'BAD_REQUEST' });
});

test('commit requires a configured target and an own registered, uncommitted or failed solution', async () => {
  const solutions = [solution({ captureId: id(1), state: 'NONE' }), solution({ captureId: id(2), state: 'FAILED' }), solution({ captureId: id(3), state: 'SUCCEEDED' })];
  const fake = server(solutions, target);
  const service = new SiteSyncService({ accountId: async () => '7', fetcher: fake.fetcher });
  assert.deepEqual(await service.commit('JUNGOL', [id(1), id(2)]), { ok: true, states: { [id(1)]: 'PENDING', [id(2)]: 'PENDING' } });
  assert.deepEqual(fake.posts[0], { path: '/api/solutions/github-batch', body: { captureIds: [id(1), id(2)], settingsVersion: 3, installationId: 11, owner: 'me', repository: 'archive', branch: 'main' } });
  assert.deepEqual(await service.commit('JUNGOL', [id(3)]), { ok: false, error: 'COMMIT_REJECTED' });
  assert.deepEqual(await service.commit('JUNGOL', [id(9)]), { ok: false, error: 'NOT_REGISTERED' });
  assert.deepEqual(await service.commit('SWEA', [id(1)]), { ok: false, error: 'NOT_REGISTERED' }, 'another platform cannot commit it');
  assert.deepEqual(await new SiteSyncService({ accountId: async () => '7', fetcher: server(solutions, { version: 3 }).fetcher }).commit('JUNGOL', [id(1)]), { ok: false, error: 'GITHUB_NOT_CONFIGURED' });
  assert.equal(fake.posts.length, 1);
});
