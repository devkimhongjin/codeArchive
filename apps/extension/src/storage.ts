import { DEFAULT_CAPTURE_SETTINGS, type Capture, type CaptureSettings, type SyncState } from "./types";

export const DATABASE_NAME = "codearchive-local";
export const DATABASE_VERSION = 1;
export const CAPTURE_STORE_NAME = "captures";
export const SETTINGS_STORE_NAME = "settings";
const SETTINGS_KEY = "settings";

export interface CaptureStore {
  putCapture(capture: Capture): Promise<{ created: boolean }>;
  /** Returns retained captures, newest first. A limit is useful for small UI previews. */
  listAll(limit?: number): Promise<Capture[]>;
  listPending(excludedCaptureIds?: Iterable<string>, limit?: number): Promise<Capture[]>;
  countPending(): Promise<number>;
  markSynced(captureIds: Iterable<string>): Promise<string[]>;
  getSettings(): Promise<CaptureSettings>;
  updateSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings>;
}

interface StoredCapture extends Capture {
  syncState: SyncState;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(50, Math.floor(limit as number)));
}

function sortNewestFirst(left: Capture, right: Capture): number {
  const byObservedAt = right.observedAt.localeCompare(left.observedAt);
  return byObservedAt === 0 ? right.captureId.localeCompare(left.captureId) : byObservedAt;
}

function settingsWithDefaults(value: Partial<CaptureSettings> | undefined): CaptureSettings {
  return {
    autoSyncEnabled: value?.autoSyncEnabled === true,
    githubAutoCommitEnabled: value?.githubAutoCommitEnabled === true,
    githubTargetConfigured: value?.githubTargetConfigured === true
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export interface IndexedDbCaptureStoreOptions {
  databaseName?: string;
  databaseVersion?: number;
  indexedDb?: IDBFactory;
}

export class IndexedDbCaptureStore implements CaptureStore {
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly indexedDb: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbCaptureStoreOptions = {}) {
    this.databaseName = options.databaseName ?? DATABASE_NAME;
    this.databaseVersion = options.databaseVersion ?? DATABASE_VERSION;
    const indexedDb = options.indexedDb ?? globalThis.indexedDB;
    if (!indexedDb) throw new Error("IndexedDB is unavailable");
    this.indexedDb = indexedDb;
  }

  async putCapture(capture: Capture): Promise<{ created: boolean }> {
    const database = await this.open();
    const transaction = database.transaction(CAPTURE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(CAPTURE_STORE_NAME);
    const existing = await requestResult(store.get(capture.captureId));
    if (existing) {
      transaction.abort();
      return { created: false };
    }
    store.add(capture as StoredCapture);
    await transactionComplete(transaction);
    return { created: true };
  }

  async listAll(limit?: number): Promise<Capture[]> {
    const database = await this.open();
    const transaction = database.transaction(CAPTURE_STORE_NAME, "readonly");
    const values = (await requestResult(transaction.objectStore(CAPTURE_STORE_NAME).getAll())) as StoredCapture[];
    const sorted = values.sort(sortNewestFirst);
    const limited = limit === undefined ? sorted : sorted.slice(0, clampLimit(limit));
    return limited.map((capture) => structuredClone(capture));
  }

  async listPending(excludedCaptureIds: Iterable<string> = [], limit = 50): Promise<Capture[]> {
    const database = await this.open();
    const transaction = database.transaction(CAPTURE_STORE_NAME, "readonly");
    const store = transaction.objectStore(CAPTURE_STORE_NAME);
    const index = store.index("bySyncState");
    const values = await requestResult(index.getAll(IDBKeyRange.only("PENDING")));
    const excluded = new Set(excludedCaptureIds);
    return (values as StoredCapture[])
      .filter((capture) => !excluded.has(capture.captureId))
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .slice(0, clampLimit(limit));
  }

  async countPending(): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(CAPTURE_STORE_NAME, "readonly");
    return requestResult(transaction.objectStore(CAPTURE_STORE_NAME).index("bySyncState").count(IDBKeyRange.only("PENDING")));
  }

  async markSynced(captureIds: Iterable<string>): Promise<string[]> {
    const ids = [...new Set(captureIds)];
    if (ids.length === 0) return [];
    const database = await this.open();
    const transaction = database.transaction(CAPTURE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(CAPTURE_STORE_NAME);
    const synced: string[] = [];
    for (const captureId of ids) {
      const existing = (await requestResult(store.get(captureId))) as StoredCapture | undefined;
      if (!existing || existing.syncState !== "PENDING") continue;
      const updated: StoredCapture = {
        ...existing,
        syncState: "SYNCED",
        syncedAt: new Date().toISOString()
      };
      store.put(updated);
      synced.push(captureId);
    }
    await transactionComplete(transaction);
    return synced;
  }

  async getSettings(): Promise<CaptureSettings> {
    const database = await this.open();
    const transaction = database.transaction(SETTINGS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(SETTINGS_STORE_NAME);
    const current = settingsWithDefaults((await requestResult(store.get(SETTINGS_KEY))) as Partial<CaptureSettings> | undefined);
    store.put({ ...current, id: SETTINGS_KEY });
    await transactionComplete(transaction);
    return current;
  }

  async updateSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings> {
    const current = await this.getSettings();
    const next = settingsWithDefaults({ ...current, ...patch });
    // GitHub cannot be considered active without a server-side target. The
    // extension has no GitHub API or token and never changes this invariant.
    if (!next.githubTargetConfigured) next.githubAutoCommitEnabled = false;
    const database = await this.open();
    const transaction = database.transaction(SETTINGS_STORE_NAME, "readwrite");
    transaction.objectStore(SETTINGS_STORE_NAME).put({ ...next, id: SETTINGS_KEY });
    await transactionComplete(transaction);
    return next;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    const opening: Promise<IDBDatabase> = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, this.databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        const captures = database.objectStoreNames.contains(CAPTURE_STORE_NAME)
          ? request.transaction?.objectStore(CAPTURE_STORE_NAME)
          : database.createObjectStore(CAPTURE_STORE_NAME, { keyPath: "captureId" });
        if (captures && !captures.indexNames.contains("bySyncState")) {
          captures.createIndex("bySyncState", "syncState", { unique: false });
        }
        if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
          database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    this.databasePromise = opening.catch((error: unknown): never => {
      this.databasePromise = null;
      throw error;
    });
    return this.databasePromise;
  }
}

/** Small deterministic store used by unit tests and non-browser callers. */
export class MemoryCaptureStore implements CaptureStore {
  private readonly captures = new Map<string, Capture>();
  private settings: CaptureSettings = { ...DEFAULT_CAPTURE_SETTINGS };

  async putCapture(capture: Capture): Promise<{ created: boolean }> {
    if (this.captures.has(capture.captureId)) return { created: false };
    this.captures.set(capture.captureId, structuredClone(capture));
    return { created: true };
  }

  async listAll(limit?: number): Promise<Capture[]> {
    const sorted = [...this.captures.values()].sort(sortNewestFirst);
    const limited = limit === undefined ? sorted : sorted.slice(0, clampLimit(limit));
    return limited.map((capture) => structuredClone(capture));
  }

  async listPending(excludedCaptureIds: Iterable<string> = [], limit = 50): Promise<Capture[]> {
    const excluded = new Set(excludedCaptureIds);
    return [...this.captures.values()]
      .filter((capture) => capture.syncState === "PENDING" && !excluded.has(capture.captureId))
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .slice(0, clampLimit(limit))
      .map((capture) => structuredClone(capture));
  }

  async countPending(): Promise<number> {
    return [...this.captures.values()].filter((capture) => capture.syncState === "PENDING").length;
  }

  async markSynced(captureIds: Iterable<string>): Promise<string[]> {
    const synced: string[] = [];
    for (const captureId of new Set(captureIds)) {
      const capture = this.captures.get(captureId);
      if (!capture || capture.syncState !== "PENDING") continue;
      capture.syncState = "SYNCED";
      capture.syncedAt = new Date().toISOString();
      synced.push(captureId);
    }
    return synced;
  }

  async getSettings(): Promise<CaptureSettings> {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings> {
    this.settings = settingsWithDefaults({ ...this.settings, ...patch });
    if (!this.settings.githubTargetConfigured) this.settings.githubAutoCommitEnabled = false;
    return { ...this.settings };
  }
}
