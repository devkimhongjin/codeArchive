import { describe, expect, it } from "vitest";
import { markRelayConflicts, markRelayImportReceipts, openCodeArchiveDatabase } from "../solutionRepository";
import type { SolutionRecord } from "../solution";

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

const nativeIndexedDb = typeof indexedDB !== "undefined";

describe.skipIf(!nativeIndexedDb)("relay IndexedDB receipt/conflict persistence", () => {
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
      indexedDB.deleteDatabase(DB_NAME);
    }
  });
});
