import type { AuthenticatedCodeArchiveSession, CodeArchiveAuthProvider } from "./solutionSync";

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
}

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

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("CodeArchive API origin must use HTTPS.");
  return url.origin;
}

export class CodeArchiveAuthService implements CodeArchiveAuthProvider {
  private readonly apiBaseUrl: string;

  constructor(
    apiBaseUrl: string,
    private readonly store: AuthSessionStore = indexedDbAuthSessionStore,
    private readonly identity: ChromeIdentityBridge,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
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
    const login = await parseSuccess<LoginStart>(await this.fetcher(`${this.apiBaseUrl}/api/v1/auth/github/extension-login`, { method: "GET" }));
    const callbackUrl = await this.identity.launchWebAuthFlow({ url: login.authorizationUrl, interactive: true });
    const expected = new URL(this.identity.getRedirectURL("codearchive-auth"));
    const callback = new URL(callbackUrl);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) throw new Error("Unexpected auth completion URL.");
    const exchangeCode = new URLSearchParams(callback.hash.replace(/^#/, "")).get("code");
    if (!exchangeCode) throw new Error("Auth exchange code is missing.");

    const issued = await parseSuccess<IssuedSession>(await this.fetcher(`${this.apiBaseUrl}/api/v1/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: exchangeCode }),
    }));
    if (!issued.accessToken || !issued.expiresAt) throw new Error("Auth session is invalid.");
    const user = await this.fetchMe(issued.accessToken);
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
