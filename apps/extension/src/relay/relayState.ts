import {
  openCodeArchiveDatabase,
  RELAY_STATE_KEY,
  RELAY_STATE_STORE_NAME,
  type RelayStateSnapshot,
} from "../solutionRepository";

export type RelayLocalState = RelayStateSnapshot["state"];

export const RELAY_FAILURE_CATEGORIES = [
  "LOCAL_EXPIRED",
  "HTTP_401",
  "HTTP_403",
  "HTTP_OTHER",
  "MALFORMED_RESPONSE",
] as const;

export type RelayFailureCategory = typeof RELAY_FAILURE_CATEGORIES[number];

export interface RelayFailureDiagnostic {
  category: RelayFailureCategory;
  status?: number;
  occurredAt: string;
  requestId?: string;
  errorCode?: string;
}

export interface RelayStateRecord extends RelayStateSnapshot {
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
  signedChallengeId?: string;
  signedChallengeExpiresAt?: string;
  failureCount: number;
  nextRetryAt?: string;
  lastFailure?: RelayFailureDiagnostic;
}

export interface RelayStateRepository {
  get(): Promise<RelayStateRecord>;
  update(mutate: (current: RelayStateRecord) => RelayStateRecord): Promise<RelayStateRecord>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeState(value: RelayStateRecord): RelayStateRecord {
  return {
    ...value,
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    autoSyncEnabled: value.autoSyncEnabled === true,
    failureCount: Number.isSafeInteger(value.failureCount) && value.failureCount >= 0 ? value.failureCount : 0,
    lastFailure: normalizeRelayFailure(value.lastFailure),
  };
}

function boundedSafeString(value: unknown, max: number, pattern: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && pattern.test(value);
}

export function normalizeRelayFailure(value: unknown): RelayFailureDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!RELAY_FAILURE_CATEGORIES.includes(candidate.category as RelayFailureCategory)
    || typeof candidate.occurredAt !== "string" || !Number.isFinite(Date.parse(candidate.occurredAt))) return undefined;
  const status = candidate.status === undefined
    ? undefined
    : Number.isSafeInteger(candidate.status) && (candidate.status as number) >= 100 && (candidate.status as number) <= 599
      ? candidate.status as number
      : undefined;
  if (candidate.status !== undefined && status === undefined) return undefined;
  const requestId = candidate.requestId === undefined
    ? undefined
    : boundedSafeString(candidate.requestId, 128, /^[A-Za-z0-9._:-]+$/) ? candidate.requestId : undefined;
  if (candidate.requestId !== undefined && requestId === undefined) return undefined;
  const errorCode = candidate.errorCode === undefined
    ? undefined
    : boundedSafeString(candidate.errorCode, 64, /^[A-Z0-9_:-]+$/) ? candidate.errorCode : undefined;
  if (candidate.errorCode !== undefined && errorCode === undefined) return undefined;
  return {
    category: candidate.category as RelayFailureCategory,
    occurredAt: candidate.occurredAt,
    ...(status === undefined ? {} : { status }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

async function generateDeviceIdentity(): Promise<Pick<RelayStateRecord, "deviceId" | "publicKey" | "privateKey">> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable.");
  const generated = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = base64Url(await subtle.exportKey("spki", generated.publicKey));
  const privateJwk = await subtle.exportKey("jwk", generated.privateKey);
  const privateKey = await subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
  if (privateKey.extractable) throw new Error("Relay private key must be non-exportable.");
  return {
    deviceId: crypto.randomUUID().replace(/-/g, ""),
    publicKey,
    privateKey,
  };
}

async function createInitialState(): Promise<RelayStateRecord> {
  const identity = await generateDeviceIdentity();
  return {
    ...identity,
    revision: 0,
    state: "UNPAIRED",
    autoSyncEnabled: false,
    failureCount: 0,
  };
}

export class IndexedDbRelayStateRepository implements RelayStateRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  async get(): Promise<RelayStateRecord> {
    const db = await openCodeArchiveDatabase();
    try {
      const transaction = db.transaction(RELAY_STATE_STORE_NAME, "readonly");
      const existing = await requestToPromise(
        transaction.objectStore(RELAY_STATE_STORE_NAME).get(RELAY_STATE_KEY) as IDBRequest<RelayStateRecord | undefined>,
      );
      await transactionDone(transaction);
      if (existing) {
        if (!existing.privateKey || existing.privateKey.extractable) throw new Error("Stored relay private key is unsafe.");
        return normalizeState(existing);
      }
    } finally {
      db.close();
    }
    return this.update((current) => current);
  }

  async update(mutate: (current: RelayStateRecord) => RelayStateRecord): Promise<RelayStateRecord> {
    let result!: RelayStateRecord;
    const write = this.writeQueue.then(async () => {
      let initial: RelayStateRecord | undefined;
      const readDb = await openCodeArchiveDatabase();
      try {
        const transaction = readDb.transaction(RELAY_STATE_STORE_NAME, "readonly");
        const existing = await requestToPromise(
          transaction.objectStore(RELAY_STATE_STORE_NAME).get(RELAY_STATE_KEY) as IDBRequest<RelayStateRecord | undefined>,
        );
        await transactionDone(transaction);
        if (!existing) initial = await createInitialState();
      } finally {
        readDb.close();
      }

      const db = await openCodeArchiveDatabase();
      try {
        const transaction = db.transaction(RELAY_STATE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(RELAY_STATE_STORE_NAME);
        const existing = await requestToPromise(store.get(RELAY_STATE_KEY) as IDBRequest<RelayStateRecord | undefined>);
        const current = existing ? normalizeState(existing) : initial;
        if (!current) throw new Error("Relay state initialization failed.");
        if (!current.privateKey || current.privateKey.extractable) throw new Error("Stored relay private key is unsafe.");
        result = { ...mutate(current), revision: current.revision + 1 };
        store.put(result, RELAY_STATE_KEY);
        await transactionDone(transaction);
      } finally {
        db.close();
      }
    });
    this.writeQueue = write.then(() => undefined, () => undefined);
    await write;
    return result;
  }
}

export const indexedDbRelayStateRepository = new IndexedDbRelayStateRepository();

export async function signRelayChallenge(state: RelayStateRecord, challenge: string): Promise<string> {
  const signature = await crypto.subtle.sign("Ed25519", state.privateKey, new TextEncoder().encode(challenge));
  return base64Url(signature);
}
