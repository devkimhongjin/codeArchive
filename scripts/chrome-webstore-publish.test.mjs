import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configuration, inspectStatus, publish, redact } from './chrome-webstore-publish.mjs';

const base = { CWS_PUBLISHER_ID: 'publisher-test-id', CWS_STORE_ITEM_ID: 'mlhibjadcbklfdllkonhjjajhmhnoalj', CWS_VERSION: '1.0.0', CWS_ARCHIVE: 'fixture.zip' };
const revision = (state, version) => ({ state, distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] });

test('Store submission requires a manual master request and defaults to a no-upload dry run', async () => {
  const workflow = await readFile(new URL('../.github/workflows/chrome-webstore-release.yml', import.meta.url), 'utf8');
  const triggers = workflow.split(/^on:\s*$/m)[1]?.split(/^permissions:/m)[0];
  assert.ok(triggers);
  assert.deepEqual([...triggers.matchAll(/^  (\w+):\s*$/gm)].map(match => match[1]), ['workflow_dispatch']);
  assert.match(triggers, /      dry_run:\s*[\s\S]*?        default: true/);
  assert.match(workflow, /  publish:\s*\n    if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/master' && inputs\.status_only != true/);
  assert.match(workflow, /CWS_DRY_RUN: \$\{\{ inputs\.dry_run && 'true' \|\| 'false' \}\}/);
});

async function archiveFixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'cws-publish-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = resolve(directory, 'extension.zip');
  await writeFile(archive, 'zip-fixture');
  return archive;
}
function response(body, status = 200) { return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); }

test('validates publisher inputs before credentials or upload', () => {
  assert.equal(configuration(base).itemId, base.CWS_STORE_ITEM_ID);
  assert.throws(() => configuration({ ...base, CWS_PUBLISHER_ID: '' }), /PUBLISHER_ID/);
  assert.throws(() => configuration({ ...base, CWS_STORE_ITEM_ID: 'not-an-item' }), /STORE_ITEM_ID/);
  assert.throws(() => configuration({ ...base, CWS_VERSION: '1.0' }), /VERSION/);
});

test('dry run does not require a token or call the Chrome Web Store API', async () => {
  const result = await publish({ env: { ...base, CWS_DRY_RUN: 'true' }, fetcher: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(result, { status: 'DRY_RUN', itemId: base.CWS_STORE_ITEM_ID, version: '1.0.0' });
});

test('upload submits STAGED_PUBLISH and observes the candidate nested revision', async t => {
  const archive = await archiveFixture(t);
  const calls = [];
  const responses = [
    { itemId: base.CWS_STORE_ITEM_ID },
    { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
    { itemId: base.CWS_STORE_ITEM_ID },
    { publishedItemRevisionStatus: revision('PUBLISHED', '0.3.3'), submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0') },
  ];
  const fetcher = async (url, init) => { calls.push([String(url), init]); return response(responses.shift()); };
  const result = await publish({ env: { ...base, CWS_ARCHIVE: archive, CWS_ACCESS_TOKEN: 'secret-token' }, fetcher, sleep: async () => {}, maxPolls: 2 });
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.match(calls[0][0], /:fetchStatus$/);
  assert.match(calls[1][0], /:upload$/);
  const publishCall = calls.find(([url]) => url.endsWith(':publish'));
  assert.ok(publishCall);
  assert.deepEqual(JSON.parse(String(publishCall[1].body)), { publishType: 'STAGED_PUBLISH' });
  assert.match(String(calls[1][1].headers.Authorization), /secret-token/);
});

test('does not replace an identical revision already submitted for review', async () => {
  let calls = 0;
  const result = await publish({
    env: { ...base, CWS_ACCESS_TOKEN: 'secret-token' },
    fetcher: async () => { calls += 1; return response({ submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0') }); },
  });
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(calls, 1);
});

test('blocks upload while a different revision is pending review', async () => {
  await assert.rejects(() => publish({
    env: { ...base, CWS_ACCESS_TOKEN: 'secret-token' },
    fetcher: async () => response({ submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.1') }),
  }), /different revision pending review/);
});

test('polls an asynchronous upload before requesting default review', async t => {
  const archive = await archiveFixture(t);
  const calls = [];
  const responses = [
    { itemId: base.CWS_STORE_ITEM_ID },
    { uploadState: 'IN_PROGRESS' },
    { lastAsyncUploadState: 'SUCCEEDED' },
    { itemId: base.CWS_STORE_ITEM_ID },
    { submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0') },
  ];
  const result = await publish({
    env: { ...base, CWS_ARCHIVE: archive, CWS_ACCESS_TOKEN: 'secret-token' },
    fetcher: async (url, init) => { calls.push([String(url), init]); return response(responses.shift()); }, sleep: async () => {}, maxPolls: 2,
  });
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(calls.filter(([url]) => url.endsWith(':publish')).length, 1);
});

test('bounds asynchronous upload polling and rejects malformed API data', async t => {
  const archive = await archiveFixture(t);
  const env = { ...base, CWS_ARCHIVE: archive, CWS_ACCESS_TOKEN: 'secret-token' };
  const pending = [{ itemId: base.CWS_STORE_ITEM_ID }, { uploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'IN_PROGRESS' }];
  await assert.rejects(() => publish({ env, fetcher: async () => response(pending.shift()), sleep: async () => {}, maxPolls: 1 }), /upload polling timed out/);
  await assert.rejects(() => publish({ env, fetcher: async () => response('not json'), sleep: async () => {} }), /invalid JSON during fetch status/);
  await assert.rejects(() => publish({ env, fetcher: async (_url, init) => response(init.phase === 'fetch status' ? { itemId: base.CWS_STORE_ITEM_ID } : { uploadState: 'SUCCEEDED', crxVersion: '1.0.1' }), sleep: async () => {} }), /uploaded version does not match/);
});

test('never treats a prior upload status as completion for a malformed or unpolled new upload', async t => {
  const archive = await archiveFixture(t);
  const env = { ...base, CWS_ARCHIVE: archive, CWS_ACCESS_TOKEN: 'secret-token' };
  await assert.rejects(() => publish({
    env,
    fetcher: async (_url, init) => response(init.phase === 'fetch status'
      ? { itemId: base.CWS_STORE_ITEM_ID, lastAsyncUploadState: 'SUCCEEDED' }
      : {}),
    sleep: async () => {},
  }), /invalid upload state/);
  await assert.rejects(() => publish({
    env,
    fetcher: async (_url, init) => response(init.phase === 'fetch status'
      ? { itemId: base.CWS_STORE_ITEM_ID, lastAsyncUploadState: 'SUCCEEDED' }
      : { uploadState: 'IN_PROGRESS' }),
    sleep: async () => {}, maxPolls: 0,
  }), /upload polling timed out/);
});

test('redacts bearer values from API failures', () => {
  assert.doesNotMatch(redact('Bearer abc.def access_token=xyz'), /abc\.def|xyz/);
});

test('status uses one GET without an archive and filters credentials and unrelated metadata', async () => {
  const env = { CWS_PUBLISHER_ID: base.CWS_PUBLISHER_ID, CWS_STORE_ITEM_ID: base.CWS_STORE_ITEM_ID, CWS_ACCESS_TOKEN: 'secret-token' };
  let calls = 0;
  const result = await inspectStatus({ env, fetcher: async (url, init) => {
    calls += 1;
    assert.match(url, /:fetchStatus$/);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, 'Bearer secret-token');
    return response({ publishedItemRevisionStatus: revision('PUBLISHED', '1.0.0'), submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.1'), access_token: 'never-output', privateMetadata: 'never-output' });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { itemId: base.CWS_STORE_ITEM_ID, published: { version: '1.0.0', state: 'PUBLISHED' }, submitted: { version: '1.0.1', state: 'PENDING_REVIEW' } });
  assert.doesNotMatch(JSON.stringify(result), /secret-token|never-output/);
});

test('status represents absent revisions as unknown and rejects missing auth or malformed responses', async () => {
  const env = { ...base, CWS_ACCESS_TOKEN: 'secret-token' };
  assert.deepEqual(await inspectStatus({ env, fetcher: async () => response({}) }), { itemId: base.CWS_STORE_ITEM_ID, published: { version: null, state: null }, submitted: { version: null, state: null } });
  await assert.rejects(() => inspectStatus({ env: base }), /required for status/);
  await assert.rejects(() => inspectStatus({ env, fetcher: async () => response('not json') }), /invalid JSON/);
  await assert.rejects(() => inspectStatus({ env, fetcher: async () => response({ access_token: 'never-output' }, 403) }), /HTTP 403/);
});

test('an unknown CLI command fails before publication or authentication', () => {
  const result = spawnSync(process.execPath, [new URL('./chrome-webstore-publish.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), 'statu'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Expected no command \(publish\) or status/);
});
