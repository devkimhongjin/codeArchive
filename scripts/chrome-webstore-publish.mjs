import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const api = 'https://chromewebstore.googleapis.com';
const storeItemIdPattern = /^[a-p]{32}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;

export function redact(value) {
  return String(value ?? '').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:access[_-]?token|authorization)=?[^\s&]+/gi, '[REDACTED]');
}

function publisherConfiguration(env) {
  const values = {
    publisherId: env.CWS_PUBLISHER_ID ?? '', itemId: env.CWS_STORE_ITEM_ID ?? '',
    accessToken: env.CWS_ACCESS_TOKEN ?? '',
  };
  if (!storeItemIdPattern.test(values.itemId)) throw new Error('CWS_STORE_ITEM_ID must be a Chrome Web Store item ID');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(values.publisherId)) throw new Error('CWS_PUBLISHER_ID must be a Chrome Web Store publisher ID');
  return values;
}

export function configuration(env = process.env) {
  const values = { ...publisherConfiguration(env), version: env.CWS_VERSION ?? '', archive: env.CWS_ARCHIVE ?? '' };
  if (!versionPattern.test(values.version)) throw new Error('CWS_VERSION must be a semantic version');
  if (!values.archive) throw new Error('CWS_ARCHIVE is required');
  return values;
}

async function request(fetcher, url, init, token) {
  const response = await fetcher(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = await response.text();
  const phase = init.phase ?? 'request';
  if (!response.ok) throw new Error(`Chrome Web Store API request failed during ${phase} (HTTP ${response.status})`);
  if (!body.trim()) throw new Error(`Chrome Web Store API returned an empty response during ${phase}`);
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error(`Chrome Web Store API returned invalid JSON during ${phase}`);
  }
}

function revisionVersion(revision) {
  return revision?.distributionChannels?.map(channel => channel?.crxVersion).find(version => typeof version === 'string') ?? null;
}
function revisionState(revision) { return typeof revision?.state === 'string' ? revision.state : null; }
function isSubmittedRevision(revision, version) {
  return revisionVersion(revision) === version && ['PENDING_REVIEW', 'STAGED'].includes(revisionState(revision));
}

/** Read-only status, exposing only public item/version/state fields in CI. */
export async function inspectStatus({ env = process.env, fetcher = fetch } = {}) {
  const config = publisherConfiguration(env);
  if (!config.accessToken) throw new Error('CWS_ACCESS_TOKEN is required for status');
  const url = `${api}/v2/publishers/${encodeURIComponent(config.publisherId)}/items/${config.itemId}:fetchStatus`;
  const status = await request(fetcher, url, { method: 'GET', phase: 'fetch status' }, config.accessToken);
  const revision = value => ({ version: revisionVersion(value), state: revisionState(value) });
  return { itemId: config.itemId, published: revision(status.publishedItemRevisionStatus), submitted: revision(status.submittedItemRevisionStatus) };
}

export async function publish({ env = process.env, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPolls = 20 } = {}) {
  const config = configuration(env);
  if (env.CWS_DRY_RUN === 'true') return { status: 'DRY_RUN', itemId: config.itemId, version: config.version };
  if (!config.accessToken) throw new Error('CWS_ACCESS_TOKEN is required for upload');
  const base = `${api}/v2/publishers/${encodeURIComponent(config.publisherId)}/items/${config.itemId}`;
  const statusUrl = `${base}:fetchStatus`;
  let status = await request(fetcher, statusUrl, { method: 'GET', phase: 'fetch status' }, config.accessToken);
  const published = status.publishedItemRevisionStatus;
  const submittedRevision = status.submittedItemRevisionStatus;
  if (revisionVersion(published) === config.version && revisionState(published) === 'PUBLISHED') return { status: 'PUBLISHED', itemId: config.itemId, version: config.version };
  if (isSubmittedRevision(submittedRevision, config.version)) return { status: 'SUBMITTED', itemId: config.itemId, version: config.version };
  if (['PENDING_REVIEW', 'STAGED'].includes(revisionState(submittedRevision))) throw new Error('Chrome Web Store has a different revision pending review');

  const zip = readFileSync(config.archive);
  const uploaded = await request(fetcher, `${api}/upload/v2/publishers/${encodeURIComponent(config.publisherId)}/items/${config.itemId}:upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip, phase: 'upload',
  }, config.accessToken);
  const uploadState = uploaded.uploadState;
  const uploadSucceeded = ['SUCCEEDED', 'SUCCESS'].includes(uploadState);
  const uploadPending = ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploadState);
  if (!uploadSucceeded && !uploadPending && !['FAILED', 'FAILURE'].includes(uploadState)) throw new Error('Chrome Web Store returned an invalid upload state');
  if (['FAILED', 'FAILURE'].includes(uploadState)) throw new Error('Chrome Web Store upload failed');
  if (uploadPending) {
    // The initial status belongs to the pre-upload inspection and cannot
    // confirm this upload. Only a post-upload poll may complete it.
    if (!Number.isSafeInteger(maxPolls) || maxPolls <= 0) throw new Error('Chrome Web Store upload polling timed out');
    let uploadCompleted = false;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await sleep(3000);
      status = await request(fetcher, statusUrl, { method: 'GET', phase: 'upload status' }, config.accessToken);
      const pollState = status.lastAsyncUploadState;
      if (['FAILED', 'FAILURE'].includes(pollState)) throw new Error('Chrome Web Store upload failed');
      if (['SUCCEEDED', 'SUCCESS'].includes(pollState)) { uploadCompleted = true; break; }
      if (!['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(pollState)) throw new Error('Chrome Web Store returned an invalid upload state');
    }
    if (!uploadCompleted) throw new Error('Chrome Web Store upload polling timed out');
  }
  if (uploaded.crxVersion && uploaded.crxVersion !== config.version) throw new Error('Chrome Web Store uploaded version does not match the release version');

  // Stage after approval so the owner publishes the extension and deploys any
  // backend change together, instead of the store choosing the release time.
  const submitted = await request(fetcher, `${base}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType: 'STAGED_PUBLISH' }), phase: 'publish',
  }, config.accessToken);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const current = await request(fetcher, statusUrl, { method: 'GET', phase: 'publish status' }, config.accessToken);
    const candidate = revisionVersion(current.publishedItemRevisionStatus) === config.version ? current.publishedItemRevisionStatus
      : revisionVersion(current.submittedItemRevisionStatus) === config.version ? current.submittedItemRevisionStatus : null;
    const state = revisionState(candidate);
    if (['PUBLISHED', 'PENDING_REVIEW', 'STAGED'].includes(state)) return { status: state, itemId: config.itemId, version: config.version, submitted };
    if (['REJECTED', 'CANCELLED'].includes(state)) throw new Error(`Chrome Web Store item state ${state}`);
    await sleep(3000);
  }
  throw new Error('Chrome Web Store status polling timed out');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const operation = process.argv.length > 3 ? null : process.argv[2] === 'status' ? inspectStatus : process.argv[2] === undefined ? publish : null;
  const result = operation ? operation() : Promise.reject(new Error('Expected no command (publish) or status'));
  result.then(result => process.stdout.write(`${JSON.stringify(operation === inspectStatus ? result : { status: result.status, itemId: result.itemId, version: result.version })}\n`))
    .catch(error => { process.stderr.write(`${redact(error.message)}\n`); process.exitCode = 1; });
}
