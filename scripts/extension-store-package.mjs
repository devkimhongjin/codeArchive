import { createHash, createPublicKey } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8'));
const hosts = [
  'https://swexpertacademy.com/*', 'https://school.programmers.co.kr/*',
  'https://jungol.co.kr/*',
  'https://codearchive-dashboard-beta.netlify.app/*'
];
const retiredReleaseHost = 'https://api.github.com/*';
const developmentHost = 'http://localhost:5173/*';
const permissions = ['downloads', 'alarms', 'storage', 'scripting'];
const extensionCsp = "script-src 'self'; object-src 'self';";
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Store package: ${message}`); };

function pinnedId(key) {
  const bytes = Buffer.from(key, 'base64');
  try { createPublicKey({ key: bytes, format: 'der', type: 'spki' }); }
  catch { fail('invalid public key'); }
  return digest(bytes).slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && expected.every(value => actual.includes(value));
}

export function prepareManifest(original) {
  const manifest = structuredClone(original);
  if (manifest.manifest_version !== 3 || manifest.name !== 'CodeArchive') fail('expected CodeArchive Manifest V3');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail('invalid version');
  if (manifest.version !== release.version || manifest.minimum_chrome_version !== release.extension.minimumChromeVersion) fail('manifest does not match the release version contract');
  if (!sameSet(manifest.permissions, permissions) || manifest.optional_permissions?.length) fail('unexpected permissions; review their justification');
  const expectedHosts = [...hosts,
    ...(manifest.host_permissions?.includes(retiredReleaseHost) ? [retiredReleaseHost] : []),
    ...(manifest.host_permissions?.includes(developmentHost) ? [developmentHost] : [])];
  if (!sameSet(manifest.host_permissions, expectedHosts) || manifest.optional_host_permissions?.length) fail('unexpected host permissions');
  const external = ['https://codearchive-dashboard-beta.netlify.app/*'];
  const externalMatches = manifest.externally_connectable?.matches;
  if (!sameSet(externalMatches, externalMatches?.includes(developmentHost) ? [...external, developmentHost] : external)
    || manifest.externally_connectable.ids?.length || manifest.externally_connectable.accepts_tls_channel_id) fail('unexpected external connections');
  if (!manifest.key || !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.key)) fail('missing pinned public key');
  if (pinnedId(manifest.key) !== release.extension.id) fail('public key does not match the current local extension ID');
  if (manifest.update_url || manifest.sandbox || manifest.web_accessible_resources?.length) fail('unexpected executable resources or updater');
  if (manifest.content_security_policy && manifest.content_security_policy.extension_pages !== extensionCsp) fail('unexpected content security policy');
  for (const script of manifest.content_scripts ?? []) {
    if (!script.matches?.length || script.matches.some(match => ![
      'https://swexpertacademy.com/main/solvingProblem/solvingProblem.do*',
      'https://swexpertacademy.com/main/code/problem/problemDetail.do*',
      'https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do*',
      'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do*',
      'https://school.programmers.co.kr/*', 'https://jungol.co.kr/*'
    ].includes(match))) fail('unexpected content script scope');
    if (script.all_frames || script.match_about_blank || script.match_origin_as_fallback) fail('unexpected content script frame scope');
  }
  manifest.host_permissions = manifest.host_permissions.filter(value => value !== developmentHost && value !== retiredReleaseHost);
  manifest.externally_connectable.matches = external;
  manifest.content_security_policy = { extension_pages: extensionCsp };
  // Validate the pinned development identity above, but never submit that key.
  // The Web Store assigns its own item identity; keep the local input unchanged.
  delete manifest.key;
  return manifest;
}

function packagePath(from, ref) {
  if (!ref || /^[a-z][a-z0-9+.-]*:|^[\\/]|[?#\\]/i.test(ref)) fail(`nonlocal resource in ${from}`);
  const base = resolve('/package', dirname(from));
  const resolved = relative('/package', resolve(base, ref)).replaceAll('\\', '/');
  if (resolved.startsWith('../') || resolved === '..' || isAbsolute(resolved)) fail(`resource outside package in ${from}`);
  return resolved;
}

function requireResource(files, from, ref) {
  const path = packagePath(from, ref);
  if (!files.has(path)) fail(`missing resource ${path}`);
}

export function validateResources(files, manifest) {
  for (const path of ['popup.html', 'dashboard.html', 'history.html']) {
    if (!files.has(path)) fail(`missing page ${path}`);
  }
  requireResource(files, 'manifest.json', manifest.background?.service_worker);
  requireResource(files, 'manifest.json', manifest.action?.default_popup);
  for (const path of Object.values(manifest.icons ?? {})) requireResource(files, 'manifest.json', path);
  for (const path of Object.values(manifest.action?.default_icon ?? {})) requireResource(files, 'manifest.json', path);
  for (const script of manifest.content_scripts ?? []) {
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) requireResource(files, 'manifest.json', path);
  }
  for (const [path, bytes] of files) {
    if (!path.endsWith('.html')) continue;
    const html = bytes.toString('utf8');
    if (/<base\b|\son[a-z]+\s*=/i.test(html)) fail(`inline behavior in ${path}`);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const src = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!src || match[2].trim()) fail(`inline script in ${path}`);
      requireResource(files, path, src);
    }
    for (const match of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) requireResource(files, path, match[1]);
  }
}

async function readBuild(directory, prefix = '') {
  if (!(await lstat(directory)).isDirectory()) fail('build root must be a directory, not a symbolic link');
  const files = new Map();
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = `${prefix}${entry.name}`;
    const location = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) fail('symbolic links are not package inputs');
    if (entry.isDirectory()) {
      for (const pair of await readBuild(location, `${path}/`)) files.set(...pair);
      continue;
    }
    if (!entry.isFile() || path.startsWith('.') || /\/\./.test(path)) fail('unexpected build entry');
    if (path.endsWith('.map')) continue;
    if (path !== 'manifest.json' && !/\.(?:js|css|html|png)$/.test(path)) fail('unexpected build file; package only compiled extension assets');
    let bytes = await readFile(location);
    if (path.endsWith('.js')) bytes = Buffer.from(bytes.toString('utf8').replace(/\n?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?/g, ''));
    files.set(path, bytes);
  }
  return files;
}

function crc32(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}

// Fixed timestamps and sorted UTF-8 paths keep the ZIP independent of filesystem mtime.
export function createZip(files) {
  if (files.size > 65535) fail('ZIP64 is not supported');
  const locals = [], directory = [];
  let offset = 0;
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!path || /^[\\/]|[\\:\x00]/.test(path) || path.split('/').some(part => !part || part === '..' || part === '.')) fail('unsafe ZIP path');
    const name = Buffer.from(path);
    const compressed = deflateRawSync(bytes, { level: 9 });
    if (bytes.length > 0xffffffff || compressed.length > 0xffffffff || name.length > 65535) fail('ZIP64 is not supported');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x314, 4);
    header.copy(central, 6, 4, 30);
    central.writeUInt32LE(0o100644 * 65536, 38); central.writeUInt32LE(offset, 42);
    locals.push(header, name, compressed); directory.push(central, name);
    offset += header.length + name.length + compressed.length;
    if (offset > 0xffffffff) fail('ZIP64 is not supported');
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

export async function prepareStorePackage({ dist, output }) {
  dist = resolve(dist); output = resolve(output);
  const outputRelative = relative(dist, output).replaceAll('\\', '/');
  if (outputRelative !== '..' && !outputRelative.startsWith('../') && !isAbsolute(outputRelative)) fail('output must be outside the build directory');
  const files = await readBuild(dist);
  if (!files.has('manifest.json')) fail('missing manifest');
  const originalManifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  const manifest = prepareManifest(originalManifest);
  files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  validateResources(files, manifest);
  const zip = createZip(files);
  const name = 'codearchive-chrome-webstore.zip';
  const sha256 = digest(zip);
  const localExtensionId = pinnedId(originalManifest.key);
  const report = {
    schemaVersion: 1, status: 'PREPARATION_ONLY', version: manifest.version,
    localExtensionId, storeExtensionId: null,
    artifact: { name, sha256, bytes: zip.length },
    permissions: manifest.permissions, hostPermissions: manifest.host_permissions,
    externalMatches: manifest.externally_connectable.matches,
    checks: { localManifestUnchanged: true, developmentKeyRemoved: !Object.hasOwn(manifest, 'key'), developmentPermissionsRemoved: true, retiredReleasePermissionRemoved: true, localPageResourcesPresent: true, sourceMapsExcluded: true },
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) })),
    remainingVerification: ['Chrome runtime and interrupted-job recovery', 'Store-issued extension ID and API allowed origin', 'Published privacy policy URL and store disclosures', 'Master release source and version']
  };
  await mkdir(output, { recursive: true });
  for (const file of [name, `${name}.sha256`, 'package-report.json']) {
    try { await lstat(resolve(output, file)); fail('output artifact already exists; use a new output directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(resolve(output, name), zip, { flag: 'wx' });
  await writeFile(resolve(output, `${name}.sha256`), `${sha256}  ${name}\n`, { flag: 'wx' });
  await writeFile(resolve(output, 'package-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, dist = resolve(root, 'apps/extension/dist'), output = resolve(root, 'output/chrome-webstore')] = process.argv.slice(2);
  if (command !== 'prepare') fail('usage: node scripts/extension-store-package.mjs prepare [dist] [output]');
  const report = await prepareStorePackage({ dist, output });
  console.log(JSON.stringify({ status: report.status, version: report.version, localExtensionId: report.localExtensionId, files: report.files.length, artifact: report.artifact }, null, 2));
}
