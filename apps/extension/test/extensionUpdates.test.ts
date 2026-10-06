import assert from 'node:assert/strict';
import test from 'node:test';
import { createExtensionUpdateChecker, type ExtensionUpdateState } from '../src/extensionUpdates';
import { EXTENSION_RELEASE, fetchLatestExtensionRelease, trustedExtensionRelease } from '../../../shared/extensionRelease';

const release = (version = '0.2.3') => {
  const metadata = { schemaVersion: 1, version, releasedAt: '2026-10-06', commit: 'a'.repeat(40), extensionId: EXTENSION_RELEASE.id,
    minimumChromeVersion: '120', compatibility: { minimumDashboardVersion: '9.0.0', minimumApiVersion: '0.2.2', dashboardMinimumExtensionVersion: version },
    artifact: { name: 'codearchive-extension.zip', sha256: 'b'.repeat(64) } };
  const prefix = `https://github.com/devkimhongjin/codeArchive/releases/download/extension-v${version}/`;
  return { draft: false, tag_name: `extension-v${version}`, html_url: `https://github.com/devkimhongjin/codeArchive/releases/tag/extension-v${version}`,
    body: `<!-- codearchive-extension-metadata\n${JSON.stringify(metadata)}\n-->`, assets: [
      { name: 'codearchive-extension.zip', browser_download_url: `${prefix}codearchive-extension.zip`, digest: `sha256:${metadata.artifact.sha256}` },
      { name: 'codearchive-extension-metadata.json', browser_download_url: `${prefix}codearchive-extension-metadata.json` },
      { name: 'codearchive-extension.zip.sha256', browser_download_url: `${prefix}codearchive-extension.zip.sha256` },
    ] };
};
test('update checks coalesce, throttle across workers, omit credentials and retain verified guidance on failure', async () => {
  let stored: ExtensionUpdateState | null = null, calls = 0, time = 1_000_000;
  let fail = false;
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls++; assert.equal(url, EXTENSION_RELEASE.releaseListUrl); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    if (fail) throw Error('private provider failure');
    return { ok: true, json: async () => [release('0.2.1'), release('0.2.3')] } as Response;
  };
  const storage = { get: async () => stored, set: async (state: ExtensionUpdateState) => { stored = state } };
  const check = createExtensionUpdateChecker('0.2.2', storage, fetcher as typeof fetch, () => time);
  const [one, two] = await Promise.all([check(), check(true)]);
  assert.equal(calls, 1); assert.deepEqual(one, two); assert.equal(one.available, true); assert.equal(one.release?.version, '0.2.3');
  await createExtensionUpdateChecker('0.2.2', storage, fetcher as typeof fetch, () => time)(true); assert.equal(calls, 1);
  time += 86_400_001; fail = true;
  const unavailable = await check(); assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.release?.version, '0.2.3');
  assert.equal(calls, 2); await check(); assert.equal(calls, 2);
});
test('wrong repository, digest and fixed identity cannot create update guidance', async () => {
  for (const mutate of [
    (item: ReturnType<typeof release>) => { item.html_url = 'https://example.test/release' },
    (item: ReturnType<typeof release>) => { item.assets[0]!.digest = `sha256:${'c'.repeat(64)}` },
    (item: ReturnType<typeof release>) => { item.draft = true },
    (item: ReturnType<typeof release>) => { item.body = item.body.replace(EXTENSION_RELEASE.id, 'a'.repeat(32)) },
  ]) {
    const item = release(); mutate(item);
    await assert.rejects(fetchLatestExtensionRelease(async () => new Response(JSON.stringify([item])), 50, null));
  }
  const verified = await fetchLatestExtensionRelease(async () => new Response(JSON.stringify([release()])), 50, null);
  assert.equal(trustedExtensionRelease({ ...verified, releasePageUrl: 'https://example.test' }), null);
  assert.ok(trustedExtensionRelease(verified));
});
test('network timeout aborts and never reports latest confirmed; same or older versions are not upgrades', async () => {
  await assert.rejects(fetchLatestExtensionRelease(((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Error('aborted')));
  })) as typeof fetch, 10, null));
  for (const version of ['0.2.1', '0.2.2']) {
    const check = createExtensionUpdateChecker('0.2.2', { get: async () => null, set: async () => {} },
      async () => new Response(JSON.stringify([release(version)])));
    assert.equal((await check()).available, false);
  }
});
