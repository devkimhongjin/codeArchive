export const CODEARCHIVE_DATABASE_NAME = 'codearchive'
export const CODEARCHIVE_DATABASE_VERSION = 1

export const CODEARCHIVE_STORE_NAMES = {
  problems: 'problems',
  solutionSessions: 'solutionSessions',
  aiUsageRecords: 'aiUsageRecords',
} as const

export type CodeArchiveStoreName =
  (typeof CODEARCHIVE_STORE_NAMES)[keyof typeof CODEARCHIVE_STORE_NAMES]

export function upgradeCodeArchiveSchema(
  database: IDBDatabase,
  oldVersion: number,
): void {
  if (oldVersion >= 1) return

  for (const storeName of Object.values(CODEARCHIVE_STORE_NAMES)) {
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName, { keyPath: 'id' })
    }
  }
}
