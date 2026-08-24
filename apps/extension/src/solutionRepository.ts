import type { NewSolutionInput, SolutionRecord } from "./solution";

const DB_NAME = "codearchive";
const DB_VERSION = 1;
const STORE_NAME = "solutions";

export interface SolutionRepository {
  create(input: NewSolutionInput): Promise<SolutionRecord>;
  list(): Promise<SolutionRecord[]>;
  getById(id: string): Promise<SolutionRecord | undefined>;
  update(id: string, input: NewSolutionInput): Promise<SolutionRecord>;
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
      const done = transactionDone(transaction);
      const request = transaction.objectStore(STORE_NAME).getAll();
      const records = await requestToPromise(request);
      await done;
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } finally {
      db.close();
    }
  },

  async getById(id) {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const record = await requestToPromise(
        transaction.objectStore(STORE_NAME).get(id) as IDBRequest<SolutionRecord | undefined>,
      );
      await done;
      return record;
    } finally {
      db.close();
    }
  },

  async update(id, input) {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const existing = await requestToPromise(
        store.get(id) as IDBRequest<SolutionRecord | undefined>,
      );

      if (!existing) {
        transaction.abort();
        throw new Error("Solution record not found.");
      }

      const updated: SolutionRecord = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      store.put(updated);
      await transactionDone(transaction);
      return updated;
    } finally {
      db.close();
    }
  },
};
