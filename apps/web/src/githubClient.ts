import { MAIN_API_ORIGIN } from "./authClient";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { withRequestDeadline } from "./requestDeadline";

export interface GitHubInstallation { id: string; account: { id: string; login: string; type: "User" }; repositorySelection: string }
export interface GitHubRepository { id: string; name: string; fullName: string; private: boolean; defaultBranch: string }
export interface GitHubBranch { name: string; commitSha: string; protected: boolean; selectable: boolean }
export interface GitHubPage<T> { page: number; hasMore: boolean; items: T[] }
export interface GitHubDirectory { path: string; parentPath: string | null; entries: { name: string; path: string; type: string; browsable: boolean }[] }
export interface GitHubSelection { solutionId: string; expectedUpdatedAt: string; installationId: string; repositoryId: string; branch: string; expectedCommitSha: string; path: string | null; commitMessage: string | null }
export interface GitHubConfirmation {
  intentId: string; expiresAt: string; consentNotice: string;
  preview: {
    status: "CREATE_PREVIEW"; source: { id: string; updatedAt: string };
    target: { installationId: string; repositoryId: string; fullName: string; privateRepository: boolean; branch: string; commitSha: string; path: string };
    file: { path: string; encoding: "UTF-8"; byteLength: number; sha256: string };
    diff: { operation: "ADD_FILE"; before: ""; after: string }; commitMessage: string; blockers: [];
  };
}
export interface GitHubResult { status: string; commitSha: string | null; commitUrl: string | null; errorCode: string | null }
export interface GitHubCommitResult extends GitHubResult { intentId: string; retryAllowed: false }
export interface GitHubConsent { confirmUpload: boolean; acknowledgeVisibilityRisk: boolean; confirmPublicUpload: boolean }
export interface GitHubAutoTarget { installationId: string; repositoryId: string; branch: string; expectedCommitSha: string; folder: string; privateRepository: boolean; fullName: string }
export interface GitHubAutoEnable { target: GitHubAutoTarget; confirmAutomatic: boolean; acknowledgeVisibilityRisk: boolean; confirmPublicUpload: boolean }
export interface GitHubAutoStatus { runId: string | null; state: "OFF" | "STARTING" | "ACTIVE" | "PAUSED"; target: GitHubAutoTarget | null; enabledAt: string | null; leaseUntil: string | null; errorCode: string | null; lastResult: GitHubResult | null }
export interface GitHubClient {
  installations(signal?: AbortSignal): Promise<GitHubInstallation[]>;
  repositories(installation: string, page: number, signal?: AbortSignal): Promise<GitHubPage<GitHubRepository>>;
  branches(installation: string, repository: string, page: number, signal?: AbortSignal): Promise<GitHubPage<GitHubBranch>>;
  directory(target: GitHubAutoTarget, path: string, signal?: AbortSignal): Promise<GitHubDirectory>;
  prepare(selection: GitHubSelection, signal?: AbortSignal): Promise<GitHubConfirmation>;
  commit(id: string, consent: GitHubConsent, signal?: AbortSignal): Promise<GitHubCommitResult>;
  result(id: string, signal?: AbortSignal): Promise<GitHubCommitResult>;
  autoStatus(id?: string, signal?: AbortSignal): Promise<GitHubAutoStatus>;
  autoEnable(id: string, request: GitHubAutoEnable, signal?: AbortSignal): Promise<GitHubAutoStatus>;
  autoTick(id: string, signal?: AbortSignal): Promise<GitHubAutoStatus>;
  autoStop(id: string): Promise<GitHubAutoStatus>;
}
export class GitHubRequestError extends Error { constructor(readonly code: string) { super("GitHub request unavailable"); } }
export function githubErrorMessage(error: unknown): string {
  const code = error instanceof GitHubRequestError ? error.code : "";
  if (code === "GITHUB_INTEGRATION_UNAVAILABLE") return "GitHub 업로드가 아직 활성화되지 않았습니다. 로그인과 저장소 연결은 별개이며 운영자 설정이 필요합니다.";
  if (code === "GITHUB_PREVIEW_NOT_ELIGIBLE") return "자동 수집된 정답 풀이만 업로드할 수 있습니다. 코드를 수정한 기록은 제외됩니다.";
  if (code === "GITHUB_AUTO_ACTIVE") return "다른 화면에서 자동 커밋이 실행 중입니다. 실행 상태를 확인하고 먼저 꺼 주세요.";
  if (code === "GITHUB_AUTO_STOPPED") return "자동 커밋이 꺼졌거나 만료되었습니다. 다시 켜려면 새로 동의해 주세요.";
  if (code === "GITHUB_UPLOAD_OUTCOME_UNKNOWN" || code === "GITHUB_UPLOAD_ALREADY_ATTEMPTED") return "전송 결과를 확정할 수 없습니다. 재전송하지 말고 결과와 GitHub 저장소를 확인해 주세요.";
  if (code === "GITHUB_PREVIEW_SOURCE_CHANGED") return "풀이가 변경되었습니다. 최신 풀이를 다시 확인해 주세요.";
  if (code === "GITHUB_REFERENCE_CHANGED" || code === "GITHUB_UPLOAD_TARGET_CHANGED") return "브랜치·공개 여부·파일 상태가 바뀌었거나 대상에 파일이 있습니다. 저장소와 브랜치를 다시 선택해 주세요.";
  return "GitHub 요청을 완료하지 못했습니다. 연결과 선택 내용을 확인해 주세요. 전송 요청은 자동으로 재시도하지 않습니다.";
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const bool = (v: unknown) => typeof v === "boolean";
const uuid = (v: unknown): v is string => str(v) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const id = (v: unknown): v is string => str(v) && /^[1-9][0-9]{0,18}$/.test(v);
const sha = (v: unknown): v is string => str(v) && /^[0-9a-f]{40}$/.test(v);
const date = (v: unknown) => str(v) && Number.isFinite(Date.parse(v));
const fullName = (v: unknown) => str(v) && /^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(v);
const installation = (v: unknown): v is GitHubInstallation => object(v) && id(v.id) && object(v.account) && id(v.account.id) && str(v.account.login) && v.account.type === "User" && str(v.repositorySelection);
const repository = (v: unknown): v is GitHubRepository => object(v) && id(v.id) && str(v.name) && fullName(v.fullName) && bool(v.private) && str(v.defaultBranch);
const branch = (v: unknown): v is GitHubBranch => object(v) && str(v.name) && sha(v.commitSha) && bool(v.protected) && bool(v.selectable);
const target = (v: unknown): v is GitHubAutoTarget => object(v) && id(v.installationId) && id(v.repositoryId) && str(v.branch) && sha(v.expectedCommitSha) && str(v.folder) && bool(v.privateRepository) && fullName(v.fullName);
const result = (v: unknown): v is GitHubResult => object(v) && str(v.status) && ["READY", "SUCCEEDED", "REJECTED", "UNKNOWN", "EXPIRED"].includes(v.status)
  && (v.errorCode === null || str(v.errorCode)) && (v.status === "SUCCEEDED" ? sha(v.commitSha) && str(v.commitUrl) && /^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/commit\/[a-f0-9]{40}$/.test(v.commitUrl) && v.commitUrl.endsWith(`/commit/${v.commitSha}`) : v.commitSha === null && v.commitUrl === null);
const commitResult = (v: unknown): v is GitHubCommitResult => result(v) && object(v) && uuid(v.intentId) && v.retryAllowed === false;
const autoStatus = (v: unknown): v is GitHubAutoStatus => object(v) && (v.runId === null || uuid(v.runId)) && str(v.state) && ["OFF", "STARTING", "ACTIVE", "PAUSED"].includes(v.state)
  && (v.target === null || target(v.target)) && (v.enabledAt === null || date(v.enabledAt)) && (v.leaseUntil === null || date(v.leaseUntil)) && (v.errorCode === null || str(v.errorCode)) && (v.lastResult === null || result(v.lastResult));
const confirmation = (v: unknown): v is GitHubConfirmation => {
  if (!object(v) || !uuid(v.intentId) || !date(v.expiresAt) || !str(v.consentNotice) || !object(v.preview)) return false;
  const p = v.preview;
  return p.status === "CREATE_PREVIEW" && p.readOnly === true && p.uploadEnabled === false && object(p.source) && uuid(p.source.id) && date(p.source.updatedAt)
    && object(p.target) && id(p.target.installationId) && id(p.target.repositoryId) && fullName(p.target.fullName) && bool(p.target.privateRepository) && str(p.target.branch) && sha(p.target.commitSha) && str(p.target.path)
    && object(p.file) && p.file.path === p.target.path && p.file.encoding === "UTF-8" && typeof p.file.byteLength === "number" && Number.isSafeInteger(p.file.byteLength) && p.file.byteLength > 0 && p.file.byteLength <= 1_048_576 && str(p.file.sha256) && /^[a-f0-9]{64}$/.test(p.file.sha256)
    && object(p.diff) && p.diff.operation === "ADD_FILE" && p.diff.before === "" && str(p.diff.after) && str(p.commitMessage) && Array.isArray(p.blockers) && p.blockers.length === 0;
};
const key = (v: string, guard = id) => { if (!guard(v)) throw new GitHubRequestError("INVALID_REQUEST"); return v; };

export function createGitHubClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): GitHubClient {
  async function request<T>(path: string, guard: (v: unknown) => v is T, signal?: AbortSignal, body?: unknown, keepalive = false): Promise<T> {
    return withRequestDeadline(async (s) => {
      const response = await fetcher(`${MAIN_API_ORIGIN}/api/v1/integrations/github/${path}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", signal: s, keepalive,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (response.status === 401) throw new ArchiveSessionExpiredError();
      const value: unknown = await response.json();
      if (!response.ok) throw new GitHubRequestError(object(value) && object(value.error) && str(value.error.code) ? value.error.code : "UNAVAILABLE");
      if (!object(value) || value.success !== true || value.error !== null || !str(value.requestId) || !value.requestId.trim() || !guard(value.data)) throw new GitHubRequestError("INVALID_RESPONSE");
      return value.data;
    }, signal, 65_000);
  }
  const repoPath = (i: string, r: string) => `installations/${key(i)}/repositories/${key(r)}`;
  async function page<T>(path: string, field: string, guard: (v: unknown) => v is T, page: number, signal?: AbortSignal): Promise<GitHubPage<T>> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new GitHubRequestError("INVALID_REQUEST");
    const v = await request(path + `?page=${page}`, (v): v is Record<string, unknown> => object(v) && v.page === page && v.perPage === 30 && bool(v.hasMore) && Array.isArray(v[field]) && v[field].length <= 30 && v[field].every(guard), signal);
    return { page, hasMore: v.hasMore as boolean, items: v[field] as T[] };
  }
  return {
    installations: async (signal) => (await request("installations", (v): v is { installations: GitHubInstallation[] } => object(v) && Array.isArray(v.installations) && v.installations.length <= 1 && v.installations.every(installation), signal)).installations,
    repositories: (i, p, s) => page(`installations/${key(i)}/repositories`, "repositories", repository, p, s),
    branches: (i, r, p, s) => page(`${repoPath(i, r)}/branches`, "branches", branch, p, s),
    directory: (t, path, s) => request(`${repoPath(t.installationId, t.repositoryId)}/tree?${new URLSearchParams({ branch: t.branch, expectedCommitSha: t.expectedCommitSha, path })}`,
      (v): v is GitHubDirectory => object(v) && v.path === path && v.commitSha === t.expectedCommitSha && v.branch === t.branch && v.truncated === false && (v.parentPath === null || str(v.parentPath)) && Array.isArray(v.entries) && v.entries.length <= 1000 && v.entries.every(e => object(e) && str(e.name) && str(e.path) && str(e.type) && bool(e.browsable)), s),
    prepare: (selection, s) => request("upload-intents", confirmation, s, selection),
    commit: (v, consent, s) => request(`upload-intents/${key(v, uuid)}/commit`, (r): r is GitHubCommitResult => commitResult(r) && r.intentId === v, s, consent),
    result: (v, s) => request(`upload-intents/${key(v, uuid)}`, (r): r is GitHubCommitResult => commitResult(r) && r.intentId === v, s),
    autoStatus: (v, s) => request(`auto-commit${v ? `/${key(v, uuid)}` : ""}`, (r): r is GitHubAutoStatus => autoStatus(r) && (!v || r.runId === v), s),
    autoEnable: (v, body, s) => request(`auto-commit/${key(v, uuid)}/enable`, (r): r is GitHubAutoStatus => autoStatus(r) && r.runId === v, s, body),
    autoTick: (v, s) => request(`auto-commit/${key(v, uuid)}/tick`, (r): r is GitHubAutoStatus => autoStatus(r) && r.runId === v, s, {}),
    autoStop: (v) => request(`auto-commit/${key(v, uuid)}/stop`, (r): r is GitHubAutoStatus => autoStatus(r) && r.runId === v && r.state === "OFF", undefined, {}, true),
  };
}
export const mainApiGitHubClient = createGitHubClient();
