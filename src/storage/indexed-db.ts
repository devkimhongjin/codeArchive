import { CodeArchiveStorageError } from './errors'
import {
  CODEARCHIVE_DATABASE_NAME,
  CODEARCHIVE_DATABASE_VERSION,
  upgradeCodeArchiveSchema,
} from './schema'

function storageFailure(
  message: string,
  cause?: unknown,
): CodeArchiveStorageError {
  return new CodeArchiveStorageError('storage_error', message, { cause })
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(storageFailure('IndexedDB request failed', request.error))
  })
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(storageFailure('IndexedDB transaction aborted', transaction.error))
    transaction.onerror = () => {
      // The abort event carries the final transaction outcome.
    }
  })
}

export async function runTransaction<T>(
  database: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  let transaction: IDBTransaction
  try {
    transaction = database.transaction(storeNames, mode)
  } catch (error) {
    throw storageFailure('Failed to start IndexedDB transaction', error)
  }

  const completion = transactionToPromise(transaction)
  try {
    const value = await operation(transaction)
    await completion
    return value
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // The transaction may already be inactive or aborted.
    }
    try {
      await completion
    } catch {
      // Preserve the more specific operation error when one exists.
    }
    throw error instanceof CodeArchiveStorageError
      ? error
      : storageFailure('IndexedDB transaction failed', error)
  }
}

export interface OpenCodeArchiveDatabaseOptions {
  factory?: IDBFactory
  name?: string
  version?: number
}

export function openCodeArchiveDatabase(
  options: OpenCodeArchiveDatabaseOptions = {},
): Promise<IDBDatabase> {
  const factory = options.factory ?? globalThis.indexedDB
  if (!factory) {
    return Promise.reject(
      storageFailure('IndexedDB is not available in this environment'),
    )
  }

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(
        options.name ?? CODEARCHIVE_DATABASE_NAME,
        options.version ?? CODEARCHIVE_DATABASE_VERSION,
      )
    } catch (error) {
      reject(storageFailure('Failed to open IndexedDB', error))
      return
    }

    request.onupgradeneeded = (event) => {
      try {
        upgradeCodeArchiveSchema(request.result, event.oldVersion)
      } catch (error) {
        request.transaction?.abort()
        reject(storageFailure('Failed to upgrade IndexedDB schema', error))
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(storageFailure('Failed to open IndexedDB', request.error))
    request.onblocked = () =>
      reject(storageFailure('IndexedDB open request is blocked'))
  })
}
