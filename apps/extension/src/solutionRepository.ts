import type {
  CaptureImportRecord,
  CaptureSyncScope,
  ProgrammingLanguage,
} from "../../../packages/shared-types/src";
import type { NewSolutionInput, SolutionRecord, SolutionSyncMetadata } from "./solution";
import type { SaveResponse, SweaAcceptedCapture } from "./sweaAutoCapture";
import { captureSource, type AcceptedCapture } from "./acceptedCapture";

const DB_NAME = "codearchive";
const DB_VERSION = 2;
const STORE_NAME = "solutions";
const META_STORE_NAME = "captureMeta";
const REVISION_KEY = "revision";

export interface SolutionRepository {
  create(input: NewSolutionInput): Promise<SolutionRecord>;
  list(): Promise<SolutionRecord[]>;
  getById(id: string): Promise<SolutionRecord | undefined>;
  update(id: string, input: NewSolutionInput): Promise<SolutionRecord>;
  delete(id: string): Promise<void>;
  setSyncMetadata(id: string, sync: SolutionSyncMetadata | undefined): Promise<SolutionRecord>;
}

export interface CaptureBridgeSummary {
  pendingCount: number;
  allCount: number;
  revision: number;
}

export interface CaptureBridgePage {
  records: CaptureImportRecord[];
  nextCursor?: string;
  revision: number;
}

export interface CaptureBridgeRepository {
  summary(): Promise<CaptureBridgeSummary>;
  page(scope: CaptureSyncScope, cursor: string | undefined, limit: number): Promise<CaptureBridgePage>;
  acknowledge(clientRecordIds: readonly string[], importBatchId: string, importedAt: string): Promise<readonly string[]>;
}

export class InvalidCaptureCursorError extends Error {
  constructor() {
    super("Invalid capture cursor.");
    this.name = "InvalidCaptureCursorError";
  }
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

export function isAcceptedCaptureRecord(record: SolutionRecord): boolean {
  if (record.autoCapture?.result !== "ACCEPTED") return false;
  return (record.platform === "SWEA" && record.autoCapture.source === "SWEA_AUTO")
    || (record.platform === "PROGRAMMERS" && record.autoCapture.source === "PROGRAMMERS_AUTO");
}

/**
 * Version-1 auto captures already used their immutable Extension-generated local id
 * as the legacy direct-sync client id. Reusing it avoids creating a second server
 * identity during the capture-only migration.
 */
export function migrateCaptureIdentity(record: SolutionRecord): SolutionRecord {
  if (!isAcceptedCaptureRecord(record) || record.clientRecordId) return record;
  return { ...record, clientRecordId: record.id };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const oldVersion = event.oldVersion;
      const db = request.result;
      const transaction = request.transaction;
      if (!transaction) return;

      const solutionStore = db.objectStoreNames.contains(STORE_NAME)
        ? transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!solutionStore.indexNames.contains("createdAt")) solutionStore.createIndex("createdAt", "createdAt");

      const metaStore = db.objectStoreNames.contains(META_STORE_NAME)
        ? transaction.objectStore(META_STORE_NAME)
        : db.createObjectStore(META_STORE_NAME);
      if (oldVersion < 2) {
        metaStore.put(0, REVISION_KEY);
        const cursorRequest = solutionStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const existing = cursor.value as SolutionRecord;
          const migrated = migrateCaptureIdentity(existing);
          if (migrated !== existing) cursor.update(migrated);
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
  });
}

function solutionFields(input: NewSolutionInput): Omit<NewSolutionInput, "performance"> & Pick<NewSolutionInput, "performance"> {
  const { performance, ...fields } = input;
  return performance ? { ...fields, performance } : fields;
}

async function readRevision(transaction: IDBTransaction): Promise<number> {
  const value = await requestToPromise(transaction.objectStore(META_STORE_NAME).get(REVISION_KEY) as IDBRequest<number | undefined>);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function incrementRevision(transaction: IDBTransaction): Promise<number> {
  const current = await readRevision(transaction);
  const next = current + 1;
  transaction.objectStore(META_STORE_NAME).put(next, REVISION_KEY);
  return next;
}

async function updateStoredRecord(id: string, mutate: (record: SolutionRecord) => SolutionRecord): Promise<SolutionRecord> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestToPromise(store.get(id) as IDBRequest<SolutionRecord | undefined>);
    if (!existing) {
      transaction.abort();
      throw new Error("Solution record not found.");
    }
    const updated = mutate(existing);
    store.put(updated);
    await done;
    return updated;
  } finally { db.close(); }
}

export const indexedDbSolutionRepository: SolutionRepository = {
  async create(input) {
    const now = new Date().toISOString();
    const record: SolutionRecord = { id: crypto.randomUUID(), ...solutionFields(input), createdAt: now, updatedAt: now };
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).add(record);
      await transactionDone(transaction);
      return record;
    } finally { db.close(); }
  },

  async list() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const records = await requestToPromise(transaction.objectStore(STORE_NAME).getAll());
      await done;
      return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } finally { db.close(); }
  },

  async getById(id) {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const record = await requestToPromise(transaction.objectStore(STORE_NAME).get(id) as IDBRequest<SolutionRecord | undefined>);
      await done;
      return record;
    } finally { db.close(); }
  },

  async update(id, input) {
    return updateStoredRecord(id, (existing) => {
      const record: SolutionRecord = { ...existing, ...solutionFields(input), id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
      if (!input.performance) delete record.performance;
      return record;
    });
  },

  async delete(id) {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const existing = await requestToPromise(store.get(id) as IDBRequest<SolutionRecord | undefined>);
      store.delete(id);
      if (existing && isAcceptedCaptureRecord(existing)) await incrementRevision(transaction);
      await transactionDone(transaction);
    } finally { db.close(); }
  },

  async setSyncMetadata(id, sync) {
    return updateStoredRecord(id, (existing) => {
      const updated = { ...existing };
      if (sync) updated.sync = sync;
      else delete updated.sync;
      return updated;
    });
  },
};

export async function saveAcceptedCapture(capture: AcceptedCapture): Promise<SaveResponse> {
  const source = captureSource(capture.platform);
  const id = `${capture.platform.toLowerCase()}-auto:${capture.captureId}`;
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestToPromise(store.get(id) as IDBRequest<SolutionRecord | undefined>);
    if (existing) {
      const matches = existing.autoCapture?.source === source && existing.autoCapture.observedAt === capture.observedAt && existing.platform === capture.platform && existing.problemNumber === capture.problemNumber && existing.title === capture.title && existing.language === capture.language && existing.code === capture.code && existing.solvedAt === capture.solvedAt;
      await done;
      return matches ? { status: "duplicate", solutionId: id, savedAt: existing.createdAt } : { status: "rejected", reason: "idempotency_conflict" };
    }
    const now = new Date().toISOString();
    const record: SolutionRecord = {
      id,
      clientRecordId: crypto.randomUUID(),
      platform: capture.platform,
      problemNumber: capture.problemNumber,
      title: capture.title,
      language: capture.language,
      code: capture.code,
      solvedAt: capture.solvedAt,
      aiUsage: "unknown",
      autoCapture: {
        source,
        result: "ACCEPTED",
        observedAt: capture.observedAt,
        ...(capture.problemUrl ? { problemUrl: capture.problemUrl } : {}),
      },
      createdAt: now,
      updatedAt: now,
    };
    store.add(record);
    await incrementRevision(transaction);
    await done;
    return { status: "saved", solutionId: id, savedAt: now };
  } finally { db.close(); }
}

export function saveSweaAcceptedCapture(capture: SweaAcceptedCapture): Promise<SaveResponse> {
  return saveAcceptedCapture(capture);
}

function bridgeLanguage(value: string): ProgrammingLanguage {
  switch (value.trim().toLowerCase()) {
    case "java": return "JAVA";
    case "python": return "PYTHON";
    case "python3": return "PYTHON";
    case "c": return "C";
    case "c++": return "CPP";
    case "javascript": return "JAVASCRIPT";
    case "typescript": return "TYPESCRIPT";
    case "kotlin": return "KOTLIN";
    case "c#": return "CSHARP";
    case "go": return "GO";
    case "rust": return "RUST";
    case "swift": return "SWIFT";
    default: throw new Error("Unsupported captured language.");
  }
}

export function toCaptureImportRecord(record: SolutionRecord): CaptureImportRecord {
  if (!isAcceptedCaptureRecord(record) || !record.clientRecordId || !record.autoCapture) {
    throw new Error("Record is not an importable capture.");
  }
  return {
    clientRecordId: record.clientRecordId,
    problem: {
      platform: record.platform as "SWEA" | "PROGRAMMERS",
      platformProblemId: record.problemNumber,
      problemNumber: record.problemNumber,
      title: record.title,
      url: record.autoCapture.problemUrl ?? "",
      tags: [],
    },
    language: bridgeLanguage(record.language),
    code: record.code,
    result: "ACCEPTED",
    submittedAt: record.autoCapture.observedAt,
  };
}

function captureOrder(a: SolutionRecord, b: SolutionRecord): number {
  const byCreated = a.createdAt.localeCompare(b.createdAt);
  if (byCreated !== 0) return byCreated;
  return (a.clientRecordId ?? a.id).localeCompare(b.clientRecordId ?? b.id);
}

function isPending(record: SolutionRecord): boolean {
  return !record.dashboardImportReceipt;
}

export const indexedDbCaptureBridgeRepository: CaptureBridgeRepository = {
  async summary() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readonly");
      const records = (await requestToPromise(transaction.objectStore(STORE_NAME).getAll()) as SolutionRecord[])
        .filter(isAcceptedCaptureRecord);
      const revision = await readRevision(transaction);
      await transactionDone(transaction);
      return { pendingCount: records.filter(isPending).length, allCount: records.length, revision };
    } finally { db.close(); }
  },

  async page(scope, cursor, limit) {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readonly");
      const records = (await requestToPromise(transaction.objectStore(STORE_NAME).getAll()) as SolutionRecord[])
        .filter(isAcceptedCaptureRecord)
        .map(migrateCaptureIdentity)
        .sort(captureOrder);
      const revision = await readRevision(transaction);
      await transactionDone(transaction);

      let start = 0;
      if (cursor) {
        const index = records.findIndex((record) => record.clientRecordId === cursor);
        if (index < 0) throw new InvalidCaptureCursorError();
        start = index + 1;
      }

      const eligible = (record: SolutionRecord) => scope === "all" || isPending(record);
      const candidates = records.slice(start).filter(eligible);
      const selected = candidates.slice(0, limit);
      const last = selected.at(-1);
      let nextCursor: string | undefined;
      if (last?.clientRecordId) {
        const lastIndex = records.findIndex((record) => record.clientRecordId === last.clientRecordId);
        if (records.slice(lastIndex + 1).some(eligible)) nextCursor = last.clientRecordId;
      }
      return {
        records: selected.map(toCaptureImportRecord),
        ...(nextCursor ? { nextCursor } : {}),
        revision,
      };
    } finally { db.close(); }
  },

  async acknowledge(clientRecordIds, importBatchId, importedAt) {
    const requested = new Set(clientRecordIds);
    const db = await openDatabase();
    try {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const records = await requestToPromise(store.getAll()) as SolutionRecord[];
      const acknowledged: string[] = [];
      for (const record of records) {
        if (!record.clientRecordId || !requested.has(record.clientRecordId) || !isAcceptedCaptureRecord(record)) continue;
        store.put({ ...record, dashboardImportReceipt: { importedAt, importBatchId } });
        acknowledged.push(record.clientRecordId);
      }
      if (acknowledged.length > 0) await incrementRevision(transaction);
      await transactionDone(transaction);
      return acknowledged;
    } finally { db.close(); }
  },
};
