import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  markRelayConflicts,
  markRelayImportReceipts,
  openCodeArchiveDatabase,
  RELAY_STATE_KEY,
  RELAY_STATE_STORE_NAME,
} from "../solutionRepository";
import type { SolutionRecord } from "../solution";
import { indexedDbRelayStateRepository, type RelayStateRecord } from "./relayState";

const DB_NAME = "codearchive";
const SOLUTIONS_STORE = "solutions";
const META_STORE = "captureMeta";

function record(id: string): SolutionRecord {
  return {
    id,
    clientRecordId: id,
    platform: "SWEA",
    problemNumber: "1234",
    title: "IndexedDB regression",
    language: "Java",
    code: "class Main {}",
    solvedAt: "2026-01-01T00:00:00.000Z",
    aiUsage: "unknown",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    autoCapture: {
      source: "SWEA_AUTO",
      result: "ACCEPTED",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB deletion failed."));
    request.onblocked = () => reject(new Error("IndexedDB deletion blocked."));
  });
}

const nativeIndexedDb = typeof indexedDB !== "undefined";

describe.skipIf(!nativeIndexedDb)("relay IndexedDB receipt/conflict persistence", () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  it("initializes and round-trips a stable non-exportable signing key", async () => {
    const initial = await indexedDbRelayStateRepository.get();
    expect(initial.privateKey.extractable).toBe(false);

    const db = await openCodeArchiveDatabase();
    try {
      const transaction = db.transaction(RELAY_STATE_STORE_NAME, "readonly");
      const stored = await new Promise<RelayStateRecord>((resolve, reject) => {
        const request = transaction.objectStore(RELAY_STATE_STORE_NAME).get(RELAY_STATE_KEY);
        request.onsuccess = () => resolve(request.result as RelayStateRecord);
        request.onerror = () => reject(request.error);
      });
      await transactionDone(transaction);
      expect(stored.deviceId).toBe(initial.deviceId);
      expect(stored.privateKey.extractable).toBe(false);
    } finally {
      db.close();
    }

    const restored = await indexedDbRelayStateRepository.get();
    expect(restored.deviceId).toBe(initial.deviceId);
    expect(restored.privateKey.extractable).toBe(false);
  });

  it("updates relay metadata and capture revision in one real multi-store transaction", async () => {
    const db = await openCodeArchiveDatabase();
    try {
      const seed = db.transaction([SOLUTIONS_STORE, META_STORE], "readwrite");
      seed.objectStore(SOLUTIONS_STORE).put(record("imported"));
      seed.objectStore(SOLUTIONS_STORE).put(record("conflict"));
      seed.objectStore(META_STORE).put(0, "revision");
      await transactionDone(seed);
    } finally {
      db.close();
    }

    await expect(markRelayImportReceipts(["imported"], "2026-01-01T00:00:01.000Z")).resolves.toBeUndefined();
    await expect(markRelayConflicts(["conflict"], "2026-01-01T00:00:02.000Z", "CLIENT_RECORD_CONFLICT")).resolves.toBeUndefined();

    const verifyDb = await openCodeArchiveDatabase();
    try {
      const transaction = verifyDb.transaction([SOLUTIONS_STORE, META_STORE], "readonly");
      const importedRequest = transaction.objectStore(SOLUTIONS_STORE).get("imported");
      const conflictRequest = transaction.objectStore(SOLUTIONS_STORE).get("conflict");
      const revisionRequest = transaction.objectStore(META_STORE).get("revision");
      const importedPromise = new Promise<SolutionRecord>((resolve, reject) => {
        importedRequest.onsuccess = () => resolve(importedRequest.result as SolutionRecord);
        importedRequest.onerror = () => reject(importedRequest.error);
      });
      const conflictPromise = new Promise<SolutionRecord>((resolve, reject) => {
        conflictRequest.onsuccess = () => resolve(conflictRequest.result as SolutionRecord);
        conflictRequest.onerror = () => reject(conflictRequest.error);
      });
      const revisionPromise = new Promise<number>((resolve, reject) => {
        revisionRequest.onsuccess = () => resolve(revisionRequest.result as number);
        revisionRequest.onerror = () => reject(revisionRequest.error);
      });
      const [imported, conflict, revision] = await Promise.all([importedPromise, conflictPromise, revisionPromise]);
      await transactionDone(transaction);

      expect(imported.code).toBe("class Main {}");
      expect(imported.relayImportReceipt).toEqual({ importedAt: "2026-01-01T00:00:01.000Z" });
      expect(conflict.code).toBe("class Main {}");
      expect(conflict.relayConflict).toEqual({ occurredAt: "2026-01-01T00:00:02.000Z", errorCode: "CLIENT_RECORD_CONFLICT" });
      expect(revision).toBe(2);
    } finally {
      verifyDb.close();
    }
  });
});
