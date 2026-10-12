import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';
import type { Capture } from './types';

export type CloudAccount = { id: number; githubId: string };
export class CloudRequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function cloudRequest<T>(path: string, expectedGithubId?: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Invalid API path');
  const headers: Record<string, string> = { ...(expectedGithubId ? { 'X-CodeArchive-Account': expectedGithubId, 'X-CodeArchive-Github-Id': expectedGithubId } : {}) };
  if (body !== undefined) {
    const csrf = await cloudRequest<{ headerName: string; token: string }>('/api/auth/csrf', undefined, undefined, fetcher);
    if (!['X-XSRF-TOKEN', 'X-CSRF-TOKEN'].includes(csrf.headerName) || typeof csrf.token !== 'string' || !csrf.token) throw new Error('로그인 보안 정보를 확인하지 못했습니다.');
    headers[csrf.headerName] = csrf.token; headers['Content-Type'] = 'application/json';
  }
  const response = await fetcher(new URL(path, PUBLIC_API_ORIGIN), { credentials: 'include', cache: 'no-store', headers,
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new CloudRequestError(response.status === 401 || response.status === 403 ? 'CodeArchive 로그인 상태를 확인해 주세요.' : `서버 요청을 완료하지 못했습니다 (${response.status}).`, response.status);
  return response.json() as Promise<T>;
}
export async function confirmCloudAccount(account: string, fetcher: typeof fetch = fetch): Promise<CloudAccount> {
  const user = await cloudRequest<CloudAccount>('/api/auth/me', undefined, undefined, fetcher);
  if (!user || !Number.isSafeInteger(user.id) || typeof user.githubId !== 'string' || `${user.id}:${user.githubId}` !== account)
    throw new Error('수집·커밋을 시작한 계정과 현재 로그인 계정이 다릅니다.');
  return user;
}
export async function registerHistoricalOnServer(capture: Capture, account: string, fetcher: typeof fetch = fetch) {
  const user = await confirmCloudAccount(account, fetcher);
  const known = await cloudRequest<string[]>(`/api/solutions/historical-submission-ids?platform=${capture.platform}`, user.githubId, undefined, fetcher);
  if (!Array.isArray(known) || known.some(id => typeof id !== 'string')) throw new Error('서버 제출 기록을 확인하지 못했습니다.');
  if (known.includes(capture.historicalSubmissionId!)) return { ok: true, created: false };
  await confirmCloudAccount(account, fetcher);
  const result = await cloudRequest<{ acceptedCaptureIds: string[] }>('/api/solutions/bulk', user.githubId, { captures: [capture] }, fetcher);
  if (!Array.isArray(result.acceptedCaptureIds) || result.acceptedCaptureIds.length !== 1 || result.acceptedCaptureIds[0] !== capture.captureId)
    throw new Error('서버 등록을 확인하지 못했습니다.');
  return { ok: true, created: true };
}
