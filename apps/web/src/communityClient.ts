import { MAIN_API_ORIGIN } from "./authClient";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { withRequestDeadline } from "./requestDeadline";

export interface Sharing { publicSolution: boolean; canPublish: boolean; eligible: boolean }
export interface CommunityAuthor { id: string; login: string }
export interface SharedSolution {
  id: string; platform: string; problemNumber: string; title: string; language: string;
  code: string | null; publishedAt: string; author: CommunityAuthor; likeCount: number; commentCount: number; liked: boolean;
}
export interface CommunityComment { id: string; author: CommunityAuthor; body: string; createdAt: string; updatedAt: string }
export interface CommunityPage<T> { items: T[]; hasMore: boolean }
export class CommunityUnavailableError extends Error {}
export class CommunityRateLimitError extends Error {}
export interface CommunityClient {
  sharing(id: string, signal?: AbortSignal): Promise<Sharing>;
  publish(id: string, value: boolean, signal?: AbortSignal): Promise<Sharing>;
  peers(id: string, language: string, offset: number, signal?: AbortSignal): Promise<CommunityPage<SharedSolution>>;
  detail(id: string, signal?: AbortSignal): Promise<SharedSolution>;
  comments(id: string, offset: number, signal?: AbortSignal): Promise<CommunityPage<CommunityComment>>;
  addComment(id: string, body: string, signal?: AbortSignal): Promise<CommunityComment>;
  editComment(id: string, comment: string, body: string, signal?: AbortSignal): Promise<CommunityComment>;
  deleteComment(id: string, comment: string, signal?: AbortSignal): Promise<void>;
  like(id: string, liked: boolean, signal?: AbortSignal): Promise<void>;
  report(id: string, reason: string, signal?: AbortSignal): Promise<void>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const communityId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const string = (v: unknown): v is string => typeof v === "string";
const date = (v: unknown) => string(v) && Number.isFinite(Date.parse(v));
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const author = (v: unknown) => object(v) && communityId(v.id) && string(v.login);
const sharing = (v: unknown): v is Sharing => object(v) && typeof v.publicSolution === "boolean" && typeof v.canPublish === "boolean" && typeof v.eligible === "boolean";
const solution = (v: unknown): v is SharedSolution => object(v) && communityId(v.id) && string(v.platform) && string(v.problemNumber)
  && string(v.title) && string(v.language) && (v.code === null || string(v.code)) && date(v.publishedAt) && author(v.author)
  && count(v.likeCount) && count(v.commentCount) && typeof v.liked === "boolean";
const comment = (v: unknown): v is CommunityComment => object(v) && communityId(v.id) && author(v.author) && string(v.body) && date(v.createdAt) && date(v.updatedAt);
const page = <T,>(guard: (v: unknown) => v is T, limit: number) => (v: unknown): v is CommunityPage<T> =>
  object(v) && Array.isArray(v.items) && v.items.length <= limit && v.items.every(guard) && typeof v.hasMore === "boolean";
const done = (v: unknown): v is { saved: true } => object(v) && v.saved === true;
const idPath = (id: string) => { if (!communityId(id)) throw new Error("Invalid community id"); return id; };

export function createCommunityClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): CommunityClient {
  async function request<T>(path: string, guard: (v: unknown) => v is T, signal?: AbortSignal, method = "GET", body?: unknown): Promise<T> {
    return withRequestDeadline(async (requestSignal) => {
      const response = await fetcher(`${MAIN_API_ORIGIN}/api/v1/community/${path}`, {
        method, credentials: "include", cache: "no-store", signal: requestSignal,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (response.status === 401) throw new ArchiveSessionExpiredError();
      if (response.status === 403 || response.status === 404) throw new CommunityUnavailableError();
      if (response.status === 429) throw new CommunityRateLimitError();
      if (!response.ok) throw new Error("Community request failed");
      const value: unknown = await response.json();
      if (!object(value) || value.success !== true || value.error !== null || !string(value.requestId) || !value.requestId.trim() || !guard(value.data)) throw new Error("Invalid community response");
      return value.data;
    }, signal);
  }
  return {
    sharing: (id, signal) => request(`sharing/${idPath(id)}`, sharing, signal),
    publish: (id, value, signal) => request(`sharing/${idPath(id)}`, sharing, signal, "POST", { publicSolution: value }),
    peers: (id, language, offset, signal) => request(`peers/${idPath(id)}?language=${encodeURIComponent(language)}&offset=${offset}`, page(solution, 20), signal),
    detail: (id, signal) => request(`solutions/${idPath(id)}`, (v): v is SharedSolution => solution(v) && string(v.code), signal),
    comments: (id, offset, signal) => request(`solutions/${idPath(id)}/comments?offset=${offset}`, page(comment, 50), signal),
    addComment: (id, body, signal) => request(`solutions/${idPath(id)}/comments`, comment, signal, "POST", { body }),
    editComment: (id, cid, body, signal) => request(`solutions/${idPath(id)}/comments/${idPath(cid)}`, comment, signal, "POST", { body }),
    deleteComment: async (id, cid, signal) => { await request(`solutions/${idPath(id)}/comments/${idPath(cid)}`, done, signal, "DELETE"); },
    like: async (id, liked, signal) => { await request(`solutions/${idPath(id)}/like`, done, signal, "POST", { liked }); },
    report: async (id, reason, signal) => { await request(`solutions/${idPath(id)}/report`, done, signal, "POST", { reason }); },
  };
}
export const mainApiCommunityClient = createCommunityClient();
