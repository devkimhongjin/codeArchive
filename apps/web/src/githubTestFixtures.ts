import { vi } from "vitest";
import type { GitHubAutoStatus, GitHubAutoTarget, GitHubClient, GitHubConfirmation, GitHubCommitResult } from "./githubClient";
import type { DashboardSolution } from "./archiveTypes";
export const githubTestSource: DashboardSolution = { id: "11111111-1111-4111-8111-111111111111", platform: "SWEA", problemNumber: "1206", title: "Synthetic solution", language: "Java", code: "class Synthetic {}", source: "captured", updatedAt: "2026-09-01T00:00:00Z", solvedAt: null };
export const githubTestTarget: GitHubAutoTarget = { installationId: "701", repositoryId: "801", branch: "main", expectedCommitSha: "a".repeat(40), folder: "", privateRepository: true, fullName: "synthetic/solutions" };
export const githubTestOff: GitHubAutoStatus = { runId: null, state: "OFF", target: null, enabledAt: null, leaseUntil: null, errorCode: null, lastResult: null };
export const githubTestConfirmation: GitHubConfirmation = { intentId: "22222222-2222-4222-8222-222222222222", expiresAt: "2099-09-01T00:10:00Z", consentNotice: "전송한 코드는 자동 회수되지 않습니다.", preview: {
  status: "CREATE_PREVIEW", source: { id: githubTestSource.id, updatedAt: githubTestSource.updatedAt }, target: { installationId: "701", repositoryId: "801", fullName: "synthetic/solutions", privateRepository: true, branch: "main", commitSha: "a".repeat(40), path: "SWEA/1206/Solution.java" },
  file: { path: "SWEA/1206/Solution.java", encoding: "UTF-8", byteLength: 18, sha256: "b".repeat(64) }, diff: { operation: "ADD_FILE", before: "", after: "class Synthetic {}" }, commitMessage: "Add SWEA 1206 solution", blockers: [],
} };
export const githubTestResult: GitHubCommitResult = { intentId: githubTestConfirmation.intentId, status: "SUCCEEDED", retryAllowed: false, commitSha: "c".repeat(40), commitUrl: `https://github.com/synthetic/solutions/commit/${"c".repeat(40)}`, errorCode: null };
export function githubTestClient(): GitHubClient {
  return {
    installations: vi.fn().mockResolvedValue([{ id: "701", account: { id: "123", login: "synthetic", type: "User" }, repositorySelection: "selected" }]),
    repositories: vi.fn().mockResolvedValue({ page: 1, hasMore: false, items: [{ id: "801", name: "solutions", fullName: "synthetic/solutions", private: true, defaultBranch: "main" }] }),
    branches: vi.fn().mockResolvedValue({ page: 1, hasMore: false, items: [{ name: "main", commitSha: "a".repeat(40), protected: false, selectable: true }] }),
    directory: vi.fn().mockResolvedValue({ path: "", parentPath: null, entries: [{ name: "archive", path: "archive", type: "DIRECTORY", browsable: true }] }),
    prepare: vi.fn().mockResolvedValue(githubTestConfirmation), commit: vi.fn().mockResolvedValue(githubTestResult), result: vi.fn().mockResolvedValue(githubTestResult),
    autoStatus: vi.fn().mockResolvedValue(githubTestOff),
    autoEnable: vi.fn(async (id, request) => ({ runId: id, state: "ACTIVE" as const, target: request.target, enabledAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 60_000).toISOString(), errorCode: null, lastResult: null })),
    autoTick: vi.fn(async id => ({ ...githubTestOff, runId: id, state: "ACTIVE" as const, target: githubTestTarget })),
    autoStop: vi.fn(async id => ({ ...githubTestOff, runId: id })),
  };
}
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
