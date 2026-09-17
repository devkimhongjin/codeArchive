import { DEFAULT_CAPTURE_SETTINGS, type Capture, type CaptureSettings, type SyncState } from "./types";
import type { SweaProblemContext } from "./sweaProblemContext";

const LIGHT_THEMES = ["github-light", "vitesse-light", "catppuccin-latte", "solarized-light", "one-light"] as const;
const DARK_THEMES = ["github-dark", "vitesse-dark", "catppuccin-mocha", "dracula", "one-dark-pro"] as const;

export const DATABASE_NAME = "codearchive-local";
export const DATABASE_VERSION = 3;
export const CAPTURE_STORE_NAME = "captures";
export const SETTINGS_STORE_NAME = "settings";
export const SWEA_PROBLEM_CONTEXT_STORE_NAME = "sweaProblemContexts";
const CAPTURE_IDENTITY_INDEX_NAME = "byProblemLanguage";
const SETTINGS_KEY = "settings";

export interface CaptureStore {
  putCapture(capture: Capture): Promise<{ created: boolean }>;
  /** Returns retained captures, newest first. A limit is useful for small UI previews. */
  listAll(limit?: number): Promise<Capture[]>;
  getCapture(captureId: string): Promise<Capture | null>;
  listPending(excludedCaptureIds?: Iterable<string>, limit?: number): Promise<Capture[]>;
  countPending(): Promise<number>;
  markSynced(captureIds: Iterable<string>): Promise<string[]>;
  getSettings(): Promise<CaptureSettings>;
  updateSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings>;
  /** Serialized atomic read/modify/write for settings-bearing background work. */
  mutateSettings(mutator: (current: CaptureSettings) => CaptureSettings): Promise<CaptureSettings>;
  /** Applies a relay result only when the exact relay snapshot is still current. */
  mutateRelayIfCurrent(relay: NonNullable<CaptureSettings["relay"]>, mutator: (current: CaptureSettings) => CaptureSettings): Promise<{ settings: CaptureSettings; applied: boolean }>;
  putSweaProblemContext(context: SweaProblemContext): Promise<void>;
  getSweaProblemContext(problemUrl: string): Promise<SweaProblemContext | null>;
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

function hasSameSubmittedCode(left: Capture, right: Capture): boolean {
  return left.platform === right.platform &&
    left.problemNumber === right.problemNumber &&
    left.language === right.language &&
    left.sourceCode === right.sourceCode;
}

function settingsWithDefaults(value: Partial<CaptureSettings> | undefined): CaptureSettings {
  const relay = value?.relay;
  return {
    autoSyncEnabled: value?.autoSyncEnabled === true,
    githubAutoCommitEnabled: value?.githubAutoCommitEnabled === true,
    githubTargetConfigured: value?.githubTargetConfigured === true,
    ...(typeof value?.copyHeader === "boolean" ? { copyHeader: value.copyHeader } : {}),
    ...(typeof value?.downloadHeader === "boolean" ? { downloadHeader: value.downloadHeader } : {}),
    ...(typeof value?.downloadFilenameTemplate === "string" ? { downloadFilenameTemplate: value.downloadFilenameTemplate.slice(0, 160) } : {}),
    ...(typeof value?.gitPathTemplate === "string" ? { gitPathTemplate: value.gitPathTemplate.slice(0, 240) } : {}),
    ...(typeof value?.name === "string" ? { name: value.name.slice(0, 100) } : {}),
    ...(typeof value?.nickname === "string" ? { nickname: value.nickname.slice(0, 100) } : {}),
    ...(typeof value?.accountId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value.accountId) ? { accountId: value.accountId } : {}),
    ...(Number.isSafeInteger(value?.accountSettingsVersion) && (value?.accountSettingsVersion as number) >= 0 ? { accountSettingsVersion: value?.accountSettingsVersion } : {}),
    ...(LIGHT_THEMES.includes(value?.lightTheme as typeof LIGHT_THEMES[number]) ? { lightTheme: value?.lightTheme } : {}),
    ...(DARK_THEMES.includes(value?.darkTheme as typeof DARK_THEMES[number]) ? { darkTheme: value?.darkTheme } : {}),
    ...(relay && typeof relay.endpoint === "string" && typeof relay.secret === "string" && typeof relay.accountId === "string" && Number.isSafeInteger(relay.generation) && ["CONFIRMED", "PENDING", "OFFLINE", "AUTH_EXPIRED", "RELAY_ERROR", "REVOCATION_PENDING"].includes(relay.status) ? { relay } : {})
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
  private settingsSerial: Promise<void> = Promise.resolve();

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
    const sameProblem = await requestResult(store.index(CAPTURE_IDENTITY_INDEX_NAME).getAll([
      capture.platform,
      capture.problemNumber,
      capture.language
    ]));
    if ((sameProblem as StoredCapture[]).some(stored => hasSameSubmittedCode(stored, capture))) {
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

  async getCapture(captureId: string): Promise<Capture | null> {
    const database = await this.open(); const transaction = database.transaction(CAPTURE_STORE_NAME, "readonly");
    const capture = await requestResult(transaction.objectStore(CAPTURE_STORE_NAME).get(captureId));
    return capture ? structuredClone(capture as Capture) : null;
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
    return this.serializeSettings(async () => {
      const database = await this.open();
      const transaction = database.transaction(SETTINGS_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SETTINGS_STORE_NAME);
      const current = settingsWithDefaults((await requestResult(store.get(SETTINGS_KEY))) as Partial<CaptureSettings> | undefined);
      store.put({ ...current, id: SETTINGS_KEY });
      await transactionComplete(transaction);
      return current;
    });
  }

  async updateSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings> {
    return this.mutateSettings(current => ({ ...current, ...patch }));
  }

  async mutateSettings(mutator: (current: CaptureSettings) => CaptureSettings): Promise<CaptureSettings> {
    return this.serializeSettings(async () => {
      const database = await this.open();
      const transaction = database.transaction(SETTINGS_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SETTINGS_STORE_NAME);
      const current = settingsWithDefaults((await requestResult(store.get(SETTINGS_KEY))) as Partial<CaptureSettings> | undefined);
      const next = settingsWithDefaults(mutator(structuredClone(current)));
      if (!next.githubTargetConfigured) next.githubAutoCommitEnabled = false;
      store.put({ ...next, id: SETTINGS_KEY });
      await transactionComplete(transaction);
      return next;
    });
  }

  async mutateRelayIfCurrent(relay: NonNullable<CaptureSettings["relay"]>, mutator: (current: CaptureSettings) => CaptureSettings): Promise<{ settings: CaptureSettings; applied: boolean }> {
    let applied = false;
    const settings = await this.mutateSettings(current => {
      if (!sameRelay(current.relay, relay)) return current;
      applied = true;
      return mutator(current);
    });
    return { settings, applied };
  }

  async putSweaProblemContext(context: SweaProblemContext): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SWEA_PROBLEM_CONTEXT_STORE_NAME, "readwrite");
    transaction.objectStore(SWEA_PROBLEM_CONTEXT_STORE_NAME).put(context);
    await transactionComplete(transaction);
  }

  async getSweaProblemContext(problemUrl: string): Promise<SweaProblemContext | null> {
    const database = await this.open();
    const transaction = database.transaction(SWEA_PROBLEM_CONTEXT_STORE_NAME, "readonly");
    const context = await requestResult(transaction.objectStore(SWEA_PROBLEM_CONTEXT_STORE_NAME).get(problemUrl));
    return context ? structuredClone(context as SweaProblemContext) : null;
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
        if (captures && !captures.indexNames.contains(CAPTURE_IDENTITY_INDEX_NAME)) {
          captures.createIndex(CAPTURE_IDENTITY_INDEX_NAME, ["platform", "problemNumber", "language"], { unique: false });
        }
        if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
          database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(SWEA_PROBLEM_CONTEXT_STORE_NAME)) {
          database.createObjectStore(SWEA_PROBLEM_CONTEXT_STORE_NAME, { keyPath: "problemUrl" });
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

  private serializeSettings<T>(work: () => Promise<T>): Promise<T> {
    const run = this.settingsSerial.then(work, work);
    this.settingsSerial = run.then(() => undefined, () => undefined);
    return run;
  }
}

/** Small deterministic store used by unit tests and non-browser callers. */
export class MemoryCaptureStore implements CaptureStore {
  private readonly captures = new Map<string, Capture>();
  private readonly sweaProblemContexts = new Map<string, SweaProblemContext>();
  private settings: CaptureSettings = { ...DEFAULT_CAPTURE_SETTINGS };
  private settingsSerial: Promise<void> = Promise.resolve();

  async putCapture(capture: Capture): Promise<{ created: boolean }> {
    if (this.captures.has(capture.captureId)) return { created: false };
    if ([...this.captures.values()].some(stored => hasSameSubmittedCode(stored, capture))) return { created: false };
    this.captures.set(capture.captureId, structuredClone(capture));
    return { created: true };
  }

  async listAll(limit?: number): Promise<Capture[]> {
    const sorted = [...this.captures.values()].sort(sortNewestFirst);
    const limited = limit === undefined ? sorted : sorted.slice(0, clampLimit(limit));
    return limited.map((capture) => structuredClone(capture));
  }

  async getCapture(captureId: string): Promise<Capture | null> { const capture = this.captures.get(captureId); return capture ? structuredClone(capture) : null; }

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
    return this.mutateSettings(current => ({ ...current, ...patch }));
  }

  async mutateSettings(mutator: (current: CaptureSettings) => CaptureSettings): Promise<CaptureSettings> {
    return this.serializeSettings(async () => {
      this.settings = settingsWithDefaults(mutator(structuredClone(this.settings)));
      if (!this.settings.githubTargetConfigured) this.settings.githubAutoCommitEnabled = false;
      return structuredClone(this.settings);
    });
  }

  async mutateRelayIfCurrent(relay: NonNullable<CaptureSettings["relay"]>, mutator: (current: CaptureSettings) => CaptureSettings): Promise<{ settings: CaptureSettings; applied: boolean }> {
    let applied = false;
    const settings = await this.mutateSettings(current => {
      if (!sameRelay(current.relay, relay)) return current;
      applied = true;
      return mutator(current);
    });
    return { settings, applied };
  }

  async putSweaProblemContext(context: SweaProblemContext): Promise<void> {
    this.sweaProblemContexts.set(context.problemUrl, structuredClone(context));
  }

  async getSweaProblemContext(problemUrl: string): Promise<SweaProblemContext | null> {
    const context = this.sweaProblemContexts.get(problemUrl);
    return context ? structuredClone(context) : null;
  }

  private serializeSettings<T>(work: () => Promise<T>): Promise<T> {
    const run = this.settingsSerial.then(work, work);
    this.settingsSerial = run.then(() => undefined, () => undefined);
    return run;
  }
}

function sameRelay(left: CaptureSettings["relay"], right: NonNullable<CaptureSettings["relay"]>): boolean {
  return !!left && left.accountId === right.accountId && left.generation === right.generation && left.secret === right.secret && left.status === right.status;
}
