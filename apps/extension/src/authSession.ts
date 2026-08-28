import { AuthLoginStageError, type AuthLoginFailureStage } from "./authDiagnostics";
import type { AuthenticatedCodeArchiveSession, CodeArchiveAuthProvider } from "./solutionSync";

const LOGIN_START_FETCH_PROBE_TIMEOUT_MS = 5_000;

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
}

interface LoginStart {
  authorizationUrl: string;
  expiresAt: string;
}

interface IssuedSession {
  accessToken: string;
  expiresAt: string;
}

export interface CodeArchiveUserIdentity {
  id: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string | null;
}

interface StoredSession {
  accessToken: string;
  expiresAt: string;
  user?: CodeArchiveUserIdentity;
}

export type AuthViewState =
  | { status: "unavailable" }
  | { status: "signed_out" }
  | { status: "authenticated"; user: CodeArchiveUserIdentity; expiresAt: string };

export interface AuthSessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export interface ChromeIdentityBridge {
  getRedirectURL(path: string): string;
  launchWebAuthFlow(options: { url: string; interactive: boolean }): Promise<string>;
  hasHostAccess?(origin: string): Promise<boolean>;
}

export type AuthLoginDelegate = () => Promise<AuthViewState>;

const DB_NAME = "codearchive-auth";
const STORE_NAME = "session";
const SESSION_KEY = "current";

function openAuthDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Auth IndexedDB open failed."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Auth IndexedDB request failed."));
  });
}

export const indexedDbAuthSessionStore: AuthSessionStore = {
  async load() {
    const db = await openAuthDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      return await requestResult(transaction.objectStore(STORE_NAME).get(SESSION_KEY) as IDBRequest<StoredSession | undefined>) ?? null;
    } finally {
      db.close();
    }
  },
  async save(session) {
    const db = await openAuthDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(session, SESSION_KEY);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Auth IndexedDB write failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Auth IndexedDB write aborted."));
      });
    } finally {
      db.close();
    }
  },
  async clear() {
    const db = await openAuthDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(SESSION_KEY);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Auth IndexedDB delete failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Auth IndexedDB delete aborted."));
      });
    } finally {
      db.close();
    }
  },
};

function parseSuccess<T>(response: Response): Promise<T> {
  return response.json().then((body) => {
    const envelope = body as ApiEnvelope<T>;
    if (!response.ok || !envelope.success || !envelope.data) throw new Error("CodeArchive API request failed.");
    return envelope.data;
  });
}

function parseLoginStartEnvelope(body: unknown): LoginStart {
  if (!body || typeof body !== "object") throw new Error("Invalid API envelope.");
  const envelope = body as Partial<ApiEnvelope<unknown>>;
  if (envelope.success !== true || !envelope.data || typeof envelope.data !== "object") {
    throw new Error("Invalid API envelope.");
  }
  const data = envelope.data as Partial<LoginStart>;
  if (typeof data.authorizationUrl !== "string" || !data.authorizationUrl || typeof data.expiresAt !== "string" || !data.expiresAt) {
    throw new Error("Invalid login-start payload.");
  }
  return { authorizationUrl: data.authorizationUrl, expiresAt: data.expiresAt };
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("CodeArchive API origin must use HTTPS.");
  return url.origin;
}

async function atLoginStage<T>(stage: AuthLoginFailureStage, action: () => Promise<T> | T): Promise<T> {
  try {
    return await action();
  } catch {
    throw new AuthLoginStageError(stage);
  }
}

export class CodeArchiveAuthService implements CodeArchiveAuthProvider {
  private readonly apiBaseUrl: string;

  constructor(
    apiBaseUrl: string,
    private readonly store: AuthSessionStore = indexedDbAuthSessionStore,
    private readonly identity: ChromeIdentityBridge,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
    private readonly loginDelegate?: AuthLoginDelegate,
  ) {
    this.apiBaseUrl = normalizeBaseUrl(apiBaseUrl);
  }

  isConfigured(): boolean {
    return Boolean(this.apiBaseUrl);
  }

  async restore(): Promise<AuthViewState> {
    if (!this.isConfigured()) return { status: "unavailable" };
    const stored = await this.loadValidStoredSession();
    if (!stored) return { status: "signed_out" };
    try {
      const user = await this.fetchMe(stored.accessToken);
      await this.store.save({ ...stored, user });
      return { status: "authenticated", user, expiresAt: stored.expiresAt };
    } catch {
      await this.store.clear();
      return { status: "signed_out" };
    }
  }

  async login(): Promise<AuthViewState> {
    if (!this.isConfigured()) return { status: "unavailable" };
    if (this.loginDelegate) return this.loginDelegate();

    if (this.identity.hasHostAccess) {
      const hasHostAccess = await atLoginStage("login_start_host_access", () => this.identity.hasHostAccess!(this.apiBaseUrl));
      if (!hasHostAccess) throw new AuthLoginStageError("login_start_host_access");
    }

    let loginResponse: Response;
    try {
      loginResponse = await this.fetcher(`${this.apiBaseUrl}/api/v1/auth/github/extension-login`, {
        method: "GET",
        cache: "no-store",
      });
    } catch {
      throw new AuthLoginStageError(await this.classifyLoginStartFetchFailure());
    }
    if (!loginResponse.ok) throw new AuthLoginStageError("login_start_http");

    const loginBody = await atLoginStage("login_start_json", () => loginResponse.json());
    const login = await atLoginStage("login_start_envelope", () => parseLoginStartEnvelope(loginBody));

    const callbackUrl = await atLoginStage("web_auth_launch", () =>
      this.identity.launchWebAuthFlow({ url: login.authorizationUrl, interactive: true }),
    );

    const exchangeCode = await atLoginStage("callback_validation", () => {
      const expected = new URL(this.identity.getRedirectURL("codearchive-auth"));
      const callback = new URL(callbackUrl);
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) throw new Error("callback mismatch");
      const code = new URLSearchParams(callback.hash.replace(/^#/, "")).get("code");
      if (!code) throw new Error("callback code missing");
      return code;
    });

    const issued = await atLoginStage("exchange", async () => {
      const session = await parseSuccess<IssuedSession>(await this.fetcher(`${this.apiBaseUrl}/api/v1/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: exchangeCode }),
      }));
      if (!session.accessToken || !session.expiresAt) throw new Error("issued session invalid");
      return session;
    });

    const user = await atLoginStage("me", () => this.fetchMe(issued.accessToken));
    await this.store.save({ accessToken: issued.accessToken, expiresAt: issued.expiresAt, user });
    return { status: "authenticated", user, expiresAt: issued.expiresAt };
  }

  async logout(): Promise<void> {
    const stored = await this.store.load();
    if (stored && this.isConfigured()) {
      try {
        await this.fetcher(`${this.apiBaseUrl}/api/v1/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${stored.accessToken}` },
        });
      } catch {
        // Local logout still wins; server revoke can fail independently.
      }
    }
    await this.store.clear();
  }

  async getAuthenticatedSession(): Promise<AuthenticatedCodeArchiveSession | null> {
    if (!this.isConfigured()) return null;
    const stored = await this.loadValidStoredSession();
    if (!stored) return null;
    return {
      request: async (path, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${stored.accessToken}`);
        const response = await this.fetcher(`${this.apiBaseUrl}${path}`, { ...init, headers });
        if (response.status === 401) await this.store.clear();
        return response;
      },
    };
  }

  private async classifyLoginStartFetchFailure(): Promise<AuthLoginFailureStage> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        this.fetcher(`${this.apiBaseUrl}/actuator/health`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error("login-start fetch probe timed out"));
          }, LOGIN_START_FETCH_PROBE_TIMEOUT_MS);
        }),
      ]);
      return "login_start_fetch_request";
    } catch {
      return "login_start_fetch_origin";
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private async loadValidStoredSession(): Promise<StoredSession | null> {
    const stored = await this.store.load();
    if (!stored) return null;
    const expiresAt = new Date(stored.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      await this.store.clear();
      return null;
    }
    return stored;
  }

  private async fetchMe(accessToken: string): Promise<CodeArchiveUserIdentity> {
    const data = await parseSuccess<CodeArchiveUserIdentity>(await this.fetcher(`${this.apiBaseUrl}/api/v1/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
    if (!data.id || !data.githubLogin) throw new Error("CodeArchive user identity is invalid.");
    return data;
  }
}
