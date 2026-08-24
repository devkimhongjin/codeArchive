import type { NewSolutionInput, SolutionRecord } from "./solution";

const DB_NAME = "codearchive";
const DB_VERSION = 1;
const STORE_NAME = "solutions";

export interface SolutionRepository {
  create(input: NewSolutionInput): Promise<SolutionRecord>;
  list(): Promise<SolutionRecord[]>;
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

export const indexedDbSolutionRepository: SolutionRepository = {
  async create(input) {
    const now = new Date().toISOString();
    const record: SolutionRecord = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };

    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).add(record);
      await transactionDone(transaction);
      return record;
    } finally {
      db.close();
    }
  },

  async list() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      const records = await requestToPromise(request);
      await transactionDone(transaction);
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } finally {
      db.close();
    }
  },
};
