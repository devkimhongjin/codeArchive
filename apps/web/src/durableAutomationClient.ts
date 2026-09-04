import { MAIN_API_ORIGIN } from "./authClient";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import type { GitHubAutoTarget } from "./githubClient";
import { withRequestDeadline } from "./requestDeadline";

export type DurableOwnershipMode = "PAGE_OWNED" | "DURABLE_SERVER";

export interface DurableAutomationProfile {
  readonly userId: string;
  readonly deviceId: string | null;
  readonly generation: number;
  readonly sourceTransferEnabled: boolean;
  readonly githubAutoCommitEnabled: boolean;
  readonly ownershipMode: DurableOwnershipMode;
  readonly targetGeneration: number;
  readonly target: GitHubAutoTarget | null;
  readonly automaticTransferConsent: boolean;
  readonly visibilityRiskConsent: boolean;
  readonly publicUploadConsent: boolean;
  readonly githubEnabledAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface DurableAutomationUpdate {
  readonly deviceId: string;
  readonly sourceTransferEnabled: boolean;
  readonly githubAutoCommitEnabled: boolean;
  readonly ownershipMode: DurableOwnershipMode;
  readonly target: GitHubAutoTarget | null;
  readonly automaticTransferConsent: boolean;
  readonly visibilityRiskConsent: boolean;
  readonly publicUploadConsent: boolean;
  readonly expectedVersion: number;
}

export interface RelayChallengeResponse {
  readonly challengeId: string;
  readonly challenge: string;
  readonly expiresAt: string;
}

export interface RelayGrantResponse {
  readonly grantId: string;
  readonly credential: string;
  readonly deviceId: string;
  readonly generation: number;
  readonly expiresAt: string;
}

export interface DurableAutomationClient {
  profile(signal?: AbortSignal): Promise<DurableAutomationProfile>;
  update(request: DurableAutomationUpdate, signal?: AbortSignal): Promise<DurableAutomationProfile>;
  relayChallenge(deviceId: string, publicKey: string, signal?: AbortSignal): Promise<RelayChallengeResponse>;
  relayGrant(request: { deviceId: string; challengeId: string; challenge: string; publicKey: string; signature: string }, signal?: AbortSignal): Promise<RelayGrantResponse>;
  revokeRelayGrant(grantId: string, signal?: AbortSignal): Promise<void>;
}

export class DurableAutomationRequestError extends Error {
  constructor(readonly code: string) {
    super("Durable automation request unavailable");
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const safeNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const safePositive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const absoluteDate = (value: unknown): value is string => str(value) && Number.isFinite(Date.parse(value));
const uuid = (value: unknown): value is string => str(value) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const numericId = (value: unknown): value is string => str(value) && /^[1-9][0-9]{0,18}$/.test(value);
const sha = (value: unknown): value is string => str(value) && /^[0-9a-f]{40}$/.test(value);
const device = (value: unknown): value is string => str(value) && /^[A-Za-z0-9_-]{16,128}$/.test(value);

function target(value: unknown): value is GitHubAutoTarget {
  if (!object(value)) return false;
  return numericId(value.installationId)
    && numericId(value.repositoryId)
    && str(value.branch) && /^[A-Za-z0-9._/-]{1,255}$/.test(value.branch)
    && sha(value.expectedCommitSha)
    && str(value.folder) && value.folder.length <= 1024
    && bool(value.privateRepository)
    && str(value.fullName) && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value.fullName);
}

function profile(value: unknown): value is DurableAutomationProfile {
  if (!object(value)) return false;
  return uuid(value.userId)
    && (value.deviceId === null || device(value.deviceId))
    && safeNonNegative(value.generation)
    && bool(value.sourceTransferEnabled)
    && bool(value.githubAutoCommitEnabled)
    && (value.ownershipMode === "PAGE_OWNED" || value.ownershipMode === "DURABLE_SERVER")
    && safeNonNegative(value.targetGeneration)
    && (value.target === null || target(value.target))
    && bool(value.automaticTransferConsent)
    && bool(value.visibilityRiskConsent)
    && bool(value.publicUploadConsent)
    && (value.githubEnabledAt === null || absoluteDate(value.githubEnabledAt))
    && safeNonNegative(value.version)
    && absoluteDate(value.updatedAt);
}

function challenge(value: unknown): value is RelayChallengeResponse {
  return object(value) && uuid(value.challengeId) && str(value.challenge) && value.challenge.length > 0 && value.challenge.length <= 256 && absoluteDate(value.expiresAt);
}

function grant(value: unknown): value is RelayGrantResponse {
  return object(value) && uuid(value.grantId) && str(value.credential) && value.credential.length > 0 && value.credential.length <= 512
    && device(value.deviceId) && safePositive(value.generation) && absoluteDate(value.expiresAt);
}

function errorCode(value: unknown): string {
  return object(value) && object(value.error) && str(value.error.code) ? value.error.code : "UNAVAILABLE";
}

export function createDurableAutomationClient(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DurableAutomationClient {
  async function request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", guard: (value: unknown) => value is T, body?: unknown, signal?: AbortSignal): Promise<T> {
    return withRequestDeadline(async (requestSignal) => {
      const response = await fetcher(`${MAIN_API_ORIGIN}${path}`, {
        method,
        credentials: "include",
        cache: "no-store",
        signal: requestSignal,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (response.status === 401) throw new ArchiveSessionExpiredError();
      const envelope: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new DurableAutomationRequestError(errorCode(envelope));
      if (!object(envelope) || envelope.success !== true || envelope.error !== null || !str(envelope.requestId) || !envelope.requestId.trim() || !guard(envelope.data)) {
        throw new DurableAutomationRequestError("INVALID_RESPONSE");
      }
      return envelope.data;
    }, signal, 65_000);
  }

  return {
    profile: (signal) => request("/api/v1/automation", "GET", profile, undefined, signal),
    update: (body, signal) => {
      if (!device(body.deviceId) || !safeNonNegative(body.expectedVersion)) throw new DurableAutomationRequestError("INVALID_REQUEST");
      if (body.target !== null && !target(body.target)) throw new DurableAutomationRequestError("INVALID_REQUEST");
      return request("/api/v1/automation", "PUT", profile, body, signal);
    },
    relayChallenge: (deviceId, publicKey, signal) => {
      if (!device(deviceId) || !str(publicKey) || !publicKey || publicKey.length > 2048) throw new DurableAutomationRequestError("INVALID_REQUEST");
      return request("/api/v1/relay/grants/challenge", "POST", challenge, { deviceId, publicKey }, signal);
    },
    relayGrant: (body, signal) => {
      if (!device(body.deviceId) || !uuid(body.challengeId) || !body.challenge || body.challenge.length > 256 || !body.publicKey || body.publicKey.length > 2048 || !body.signature || body.signature.length > 512) {
        throw new DurableAutomationRequestError("INVALID_REQUEST");
      }
      return request("/api/v1/relay/grants", "POST", grant, body, signal);
    },
    revokeRelayGrant: async (grantId, signal) => {
      if (!uuid(grantId)) throw new DurableAutomationRequestError("INVALID_REQUEST");
      await request(`/api/v1/relay/grants/${grantId}`, "DELETE", (value): value is null => value === null, undefined, signal);
    },
  };
}

export const mainApiDurableAutomationClient = createDurableAutomationClient();
