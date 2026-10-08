import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createZip, prepareManifest, prepareStorePackage, validateResources } from './extension-store-package.mjs';

const source = JSON.parse(await readFile(new URL('../apps/extension/manifest.json', import.meta.url), 'utf8'));
const bytes = value => Buffer.from(value);

function fixtureFiles() {
  return new Map([
    ['manifest.json', bytes(JSON.stringify(source))], ['background.js', bytes('console.log("background");\n//# sourceMappingURL=background.js.map\n')],
    ['background.js.map', bytes('{"sourcesContent":["development source"]}')],
    ['content.js', bytes('console.log("content")')], ['mainWorld.js', bytes('console.log("main")')],
    ['popup.html', bytes('<script src="popup.js"></script>')], ['popup.js', bytes('console.log("popup")')],
    ['dashboard.html', bytes('<script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/style.css">')],
    ['assets/index.js', bytes('console.log("dashboard")')], ['assets/style.css', bytes('body { color: black; }')],
    ['history.html', bytes('<script src="content.js"></script>')],
    ...[16, 32, 48, 128].map(size => [`icons/icon-${size}.png`, bytes(`fixture-${size}`)])
  ]);
}

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'codearchive-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = resolve(directory, 'dist'), output = resolve(directory, 'output');
  await mkdir(dist);
  for (const [path, content] of fixtureFiles()) {
    await mkdir(resolve(dist, path, '..'), { recursive: true });
    await writeFile(resolve(dist, path), content);
  }
  return { directory, dist, output };
}

// Independent central-directory reader verifies ZIP metadata, offsets and decompression.
function unzip(archive) {
  const footer = archive.subarray(-22);
  assert.equal(footer.readUInt32LE(0), 0x06054b50);
  assert.equal(footer.readUInt16LE(8), footer.readUInt16LE(10));
  const files = new Map();
  let cursor = footer.readUInt32LE(16);
  for (let index = 0; index < footer.readUInt16LE(10); index++) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    assert.equal(archive.readUInt16LE(cursor + 8), 0x800);
    assert.equal(archive.readUInt16LE(cursor + 10), 8);
    const length = archive.readUInt16LE(cursor + 28), extra = archive.readUInt16LE(cursor + 30), comment = archive.readUInt16LE(cursor + 32);
    const name = archive.subarray(cursor + 46, cursor + 46 + length).toString('utf8');
    const local = archive.readUInt32LE(cursor + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    assert.equal(archive.readUInt32LE(local + 14), archive.readUInt32LE(cursor + 16));
    assert.equal(archive.readUInt32LE(local + 18), archive.readUInt32LE(cursor + 20));
    assert.equal(archive.subarray(local + 30, local + 30 + archive.readUInt16LE(local + 26)).toString('utf8'), name);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const content = inflateRawSync(archive.subarray(start, start + archive.readUInt32LE(cursor + 20)));
    assert.equal(content.length, archive.readUInt32LE(cursor + 24));
    files.set(name, content);
    cursor += 46 + length + extra + comment;
  }
  assert.equal(cursor, footer.readUInt32LE(16) + footer.readUInt32LE(12));
  return files;
}

test('store manifest removes development grants while preserving the pinned identity and source manifest', () => {
  const before = JSON.stringify(source);
  const manifest = prepareManifest(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(manifest.key, source.key);
  assert.equal(manifest.version, source.version);
  assert.ok(manifest.host_permissions.every(value => value.startsWith('https://')));
  assert.equal(manifest.host_permissions.includes('https://api.github.com/*'), false);
  assert.deepEqual(manifest.host_permissions, source.host_permissions.filter(value => value !== 'http://localhost:5173/*' && value !== 'https://api.github.com/*'));
  assert.deepEqual(manifest.externally_connectable.matches, ['https://codearchive-dashboard-beta.netlify.app/*']);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self';");
  assert.deepEqual(prepareManifest(manifest), manifest);
});

test('unexpected permission, host, external extension and broad site scope require review', () => {
  for (const change of [
    value => value.permissions.push('cookies'),
    value => value.host_permissions.push('<all_urls>'),
    value => value.externally_connectable.ids = ['*'],
    value => value.content_scripts[0].matches.push('https://example.com/*'),
    value => value.content_scripts[0].all_frames = true,
    value => value.update_url = 'https://example.com/update',
    value => value.key = 'ZmFrZQ==',
    value => value.version = '999.0.0',
    value => value.optional_host_permissions = ['<all_urls>'],
    value => value.content_security_policy = { extension_pages: "script-src 'self' 'unsafe-eval';" }
  ]) {
    const input = structuredClone(source); change(input);
    assert.throws(() => prepareManifest(input), /Store package:/);
  }
});

test('missing dashboard dependencies and manifest scripts fail resource checks', () => {
  for (const path of ['assets/index.js', 'assets/style.css', 'background.js', 'content.js', 'icons/icon-128.png']) {
    const files = fixtureFiles(); files.delete(path);
    assert.throws(() => validateResources(files, prepareManifest(source)), /missing resource/);
  }
});

test('inline scripts, remote scripts, path escapes and HTML event handlers fail resource checks', () => {
  for (const html of [
    '<script>alert(1)</script>', '<script src="https://example.com/code.js"></script>',
    '<script src="//example.com/code.js"></script>', '<script src="../outside.js"></script>',
    '<script src="popup.js?remote=true"></script>', '<button onclick="alert(1)">click</button>',
    '<base href="https://example.com/"><script src="popup.js"></script>'
  ]) {
    const files = fixtureFiles(); files.set('popup.html', bytes(html));
    assert.throws(() => validateResources(files, prepareManifest(source)), /Store package:/);
  }
});

test('complete package is deterministic, has manifest at root, excludes source maps, and leaves the local build untouched', async t => {
  const { dist, output, directory } = await fixture(t);
  const before = await readFile(resolve(dist, 'manifest.json'));
  const report = await prepareStorePackage({ dist, output });
  const zip = await readFile(resolve(output, report.artifact.name));
  const files = unzip(zip);
  assert.equal(report.status, 'PREPARATION_ONLY');
  assert.equal(report.storeExtensionId, null);
  assert.equal(report.localExtensionId, 'oohlcmihldmfninmdcmanddfmhoonmdl');
  assert.deepEqual(await readFile(resolve(dist, 'manifest.json')), before);
  assert.equal(files.size, fixtureFiles().size - 1);
  assert.equal(files.has('background.js.map'), false);
  assert.doesNotMatch(files.get('background.js').toString(), /sourceMappingURL/);
  assert.match((await readFile(resolve(dist, 'background.js'))).toString(), /sourceMappingURL/);
  assert.equal(JSON.parse(files.get('manifest.json').toString()).host_permissions.some(value => value.includes('localhost')), false);
  assert.equal((await readFile(resolve(output, `${report.artifact.name}.sha256`), 'utf8')).split('  ')[0], report.artifact.sha256);
  const second = await prepareStorePackage({ dist, output: resolve(directory, 'second') });
  assert.equal(second.artifact.sha256, report.artifact.sha256);
  assert.deepEqual(await readFile(resolve(directory, 'second', second.artifact.name)), zip);
});

test('unexpected private or source files fail rather than entering the ZIP', async t => {
  for (const path of ['.env', 'signing.pem', 'source.ts']) {
    const { dist, output } = await fixture(t);
    await writeFile(resolve(dist, path), 'fixture only');
    await assert.rejects(prepareStorePackage({ dist, output }), /unexpected build/);
  }
});

test('symbolic links are refused, including a linked build root', async t => {
  const { dist, output, directory } = await fixture(t);
  const link = resolve(directory, 'linked');
  await symlink(dist, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareStorePackage({ dist: link, output }), /symbolic link/);
  await symlink(resolve(dist, 'icons'), resolve(dist, 'linked-icons'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareStorePackage({ dist, output }), /symbolic links/);
});

test('existing artifacts are immutable and output cannot be inside the source build', async t => {
  const { dist, output } = await fixture(t);
  await assert.rejects(prepareStorePackage({ dist, output: dist }), /outside the build/);
  await assert.rejects(prepareStorePackage({ dist, output: resolve(dist, 'nested') }), /outside the build/);
  await assert.rejects(prepareStorePackage({ dist, output: resolve(dist, '..nested') }), /outside the build/);
  const report = await prepareStorePackage({ dist, output });
  const zip = await readFile(resolve(output, report.artifact.name));
  await assert.rejects(prepareStorePackage({ dist, output }), /already exists/);
  assert.deepEqual(await readFile(resolve(output, report.artifact.name)), zip);
});

test('ZIP refuses traversal and preserves Unicode names and bytes', () => {
  for (const name of ['../escape.js', 'a/../escape.js', '/root.js', 'a\\escape.js', 'a//b.js', 'C:escape.js']) {
    assert.throws(() => createZip(new Map([[name, bytes('fixture')]])), /unsafe ZIP path/);
  }
  const files = new Map([['assets/테마.js', bytes('안녕하세요')], ['manifest.json', bytes('{}')]]);
  assert.deepEqual(unzip(createZip(files)), files);
  const crcExample = createZip(new Map([['crc.txt', bytes('123456789')]]));
  assert.equal(crcExample.readUInt32LE(14), 0xcbf43926);
});
