import type { NewSolutionInput, SolutionRecord, SolutionSyncMetadata } from "./solution";
import type { SaveResponse, SweaAcceptedCapture } from "./sweaAutoCapture";

const DB_NAME = "codearchive";
const DB_VERSION = 1;
const STORE_NAME = "solutions";

export interface SolutionRepository {
  create(input: NewSolutionInput): Promise<SolutionRecord>;
  list(): Promise<SolutionRecord[]>;
  getById(id: string): Promise<SolutionRecord | undefined>;
  update(id: string, input: NewSolutionInput): Promise<SolutionRecord>;
  delete(id: string): Promise<void>;
  setSyncMetadata(id: string, sync: SolutionSyncMetadata): Promise<SolutionRecord>;
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
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
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      await transactionDone(transaction);
    } finally { db.close(); }
  },

  async setSyncMetadata(id, sync) {
    return updateStoredRecord(id, (existing) => ({ ...existing, sync }));
  },
};

export async function saveSweaAcceptedCapture(capture: SweaAcceptedCapture): Promise<SaveResponse> {
  const id = `swea-auto:${capture.captureId}`;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite"); const store = transaction.objectStore(STORE_NAME);
    const existing = await requestToPromise(store.get(id) as IDBRequest<SolutionRecord | undefined>);
    if (existing) { const matches = existing.autoCapture?.source === "SWEA_AUTO" && existing.autoCapture.observedAt === capture.observedAt && existing.platform === capture.platform && existing.problemNumber === capture.problemNumber && existing.title === capture.title && existing.language === capture.language && existing.code === capture.code && existing.solvedAt === capture.solvedAt; await transactionDone(transaction); return matches ? { status: "duplicate", solutionId: id, savedAt: existing.createdAt } : { status: "rejected", reason: "idempotency_conflict" }; }
    const now = new Date().toISOString(); store.add({ id, platform: "SWEA", problemNumber: capture.problemNumber, title: capture.title, language: capture.language, code: capture.code, solvedAt: capture.solvedAt, aiUsage: "unknown", autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: capture.observedAt }, createdAt: now, updatedAt: now }); await transactionDone(transaction); return { status: "saved", solutionId: id, savedAt: now };
  } finally { db.close(); }
}
