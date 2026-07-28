import type { ValidationIssue } from '../common/types'

export type StorageErrorCode =
  'duplicate_id' | 'not_found' | 'validation_error' | 'storage_error'

export class CodeArchiveStorageError extends Error {
  readonly code: StorageErrorCode
  readonly cause?: unknown
  readonly issues?: ValidationIssue[]

  constructor(
    code: StorageErrorCode,
    message: string,
    options: { cause?: unknown; issues?: ValidationIssue[] } = {},
  ) {
    super(message)
    this.name = 'CodeArchiveStorageError'
    this.code = code
    this.cause = options.cause
    this.issues = options.issues
  }
}
