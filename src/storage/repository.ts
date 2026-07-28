import type {
  AIUsageRecord,
  AIUsageRecordId,
  ParseResult,
  Problem,
  ProblemId,
  SolutionSession,
  SolutionSessionId,
} from '../common/types'
import {
  parseAIUsageRecord,
  parseCoreDataAggregate,
  parseProblem,
  parseSolutionSession,
} from '../common/validators'
import { CodeArchiveStorageError } from './errors'
import {
  openCodeArchiveDatabase,
  requestToPromise,
  runTransaction,
  type OpenCodeArchiveDatabaseOptions,
} from './indexed-db'
import { CODEARCHIVE_STORE_NAMES, type CodeArchiveStoreName } from './schema'

type StoredEntity = Problem | SolutionSession | AIUsageRecord

export interface CoreRecordBundle {
  problem: Problem
  solutionSession: SolutionSession
  aiUsageRecord: AIUsageRecord
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function validated<T>(result: ParseResult<T>, entityName: string): T {
  if (!result.ok) {
    throw new CodeArchiveStorageError(
      'validation_error',
      `Invalid ${entityName}`,
      { issues: result.issues },
    )
  }
  return clone(result.value)
}

function duplicateError(storeName: CodeArchiveStoreName, id: string) {
  return new CodeArchiveStorageError(
    'duplicate_id',
    `${storeName} already contains id ${id}`,
  )
}

function notFoundError(storeName: CodeArchiveStoreName, id: string) {
  return new CodeArchiveStorageError(
    'not_found',
    `${storeName} does not contain id ${id}`,
  )
}

export class CodeArchiveRepository {
  private readonly options: OpenCodeArchiveDatabaseOptions
  private database?: IDBDatabase
  private opening?: Promise<IDBDatabase>

  constructor(options: OpenCodeArchiveDatabaseOptions = {}) {
    this.options = options
  }

  async open(): Promise<void> {
    await this.getDatabase()
  }

  close(): void {
    this.database?.close()
    this.database = undefined
    this.opening = undefined
  }

  createProblem(problem: Problem): Promise<Problem> {
    return this.create(
      CODEARCHIVE_STORE_NAMES.problems,
      validated(parseProblem(problem), 'Problem'),
    )
  }

  getProblem(id: ProblemId): Promise<Problem | undefined> {
    return this.get(CODEARCHIVE_STORE_NAMES.problems, id)
  }

  listProblems(): Promise<Problem[]> {
    return this.list(CODEARCHIVE_STORE_NAMES.problems)
  }

  updateProblem(problem: Problem): Promise<Problem> {
    return this.update(
      CODEARCHIVE_STORE_NAMES.problems,
      validated(parseProblem(problem), 'Problem'),
    )
  }

  createSolutionSession(
    solutionSession: SolutionSession,
  ): Promise<SolutionSession> {
    return this.create(
      CODEARCHIVE_STORE_NAMES.solutionSessions,
      validated(parseSolutionSession(solutionSession), 'SolutionSession'),
    )
  }

  getSolutionSession(
    id: SolutionSessionId,
  ): Promise<SolutionSession | undefined> {
    return this.get(CODEARCHIVE_STORE_NAMES.solutionSessions, id)
  }

  listSolutionSessions(): Promise<SolutionSession[]> {
    return this.list(CODEARCHIVE_STORE_NAMES.solutionSessions)
  }

  updateSolutionSession(
    solutionSession: SolutionSession,
  ): Promise<SolutionSession> {
    return this.update(
      CODEARCHIVE_STORE_NAMES.solutionSessions,
      validated(parseSolutionSession(solutionSession), 'SolutionSession'),
    )
  }

  createAIUsageRecord(aiUsageRecord: AIUsageRecord): Promise<AIUsageRecord> {
    return this.create(
      CODEARCHIVE_STORE_NAMES.aiUsageRecords,
      validated(parseAIUsageRecord(aiUsageRecord), 'AIUsageRecord'),
    )
  }

  getAIUsageRecord(id: AIUsageRecordId): Promise<AIUsageRecord | undefined> {
    return this.get(CODEARCHIVE_STORE_NAMES.aiUsageRecords, id)
  }

  listAIUsageRecords(): Promise<AIUsageRecord[]> {
    return this.list(CODEARCHIVE_STORE_NAMES.aiUsageRecords)
  }

  updateAIUsageRecord(aiUsageRecord: AIUsageRecord): Promise<AIUsageRecord> {
    return this.update(
      CODEARCHIVE_STORE_NAMES.aiUsageRecords,
      validated(parseAIUsageRecord(aiUsageRecord), 'AIUsageRecord'),
    )
  }

  async createCoreRecordBundle(
    bundle: CoreRecordBundle,
  ): Promise<CoreRecordBundle> {
    const validatedBundle = this.validateBundle(bundle)
    const { problem, solutionSession, aiUsageRecord } = validatedBundle

    const database = await this.getDatabase()
    return runTransaction(
      database,
      Object.values(CODEARCHIVE_STORE_NAMES),
      'readwrite',
      async (transaction) => {
        await this.addToStore(
          transaction.objectStore(CODEARCHIVE_STORE_NAMES.problems),
          problem,
        )
        await this.addToStore(
          transaction.objectStore(CODEARCHIVE_STORE_NAMES.solutionSessions),
          solutionSession,
        )
        await this.addToStore(
          transaction.objectStore(CODEARCHIVE_STORE_NAMES.aiUsageRecords),
          aiUsageRecord,
        )
        return clone(validatedBundle)
      },
    )
  }

  async createSolutionBundle(
    bundle: CoreRecordBundle,
  ): Promise<CoreRecordBundle> {
    const validatedBundle = this.validateBundle(bundle)
    const { problem, solutionSession, aiUsageRecord } = validatedBundle

    const database = await this.getDatabase()
    return runTransaction(
      database,
      [
        CODEARCHIVE_STORE_NAMES.problems,
        CODEARCHIVE_STORE_NAMES.solutionSessions,
        CODEARCHIVE_STORE_NAMES.aiUsageRecords,
      ],
      'readwrite',
      async (transaction) => {
        const problemKey = await requestToPromise(
          transaction
            .objectStore(CODEARCHIVE_STORE_NAMES.problems)
            .getKey(problem.id),
        )
        if (problemKey === undefined) {
          throw notFoundError(CODEARCHIVE_STORE_NAMES.problems, problem.id)
        }
        await this.addToStore(
          transaction.objectStore(CODEARCHIVE_STORE_NAMES.solutionSessions),
          solutionSession,
        )
        await this.addToStore(
          transaction.objectStore(CODEARCHIVE_STORE_NAMES.aiUsageRecords),
          aiUsageRecord,
        )
        return clone(validatedBundle)
      },
    )
  }

  async updateCoreRecordBundle(
    bundle: CoreRecordBundle,
  ): Promise<CoreRecordBundle> {
    const validatedBundle = this.validateBundle(bundle)
    const { problem, solutionSession, aiUsageRecord } = validatedBundle
    const database = await this.getDatabase()

    return runTransaction(
      database,
      Object.values(CODEARCHIVE_STORE_NAMES),
      'readwrite',
      async (transaction) => {
        const entities: Array<{
          storeName: CodeArchiveStoreName
          entity: StoredEntity
        }> = [
          {
            storeName: CODEARCHIVE_STORE_NAMES.problems,
            entity: problem,
          },
          {
            storeName: CODEARCHIVE_STORE_NAMES.solutionSessions,
            entity: solutionSession,
          },
          {
            storeName: CODEARCHIVE_STORE_NAMES.aiUsageRecords,
            entity: aiUsageRecord,
          },
        ]

        for (const { storeName, entity } of entities) {
          const store = transaction.objectStore(storeName)
          const existing = await requestToPromise(store.getKey(entity.id))
          if (existing === undefined) {
            throw notFoundError(storeName, entity.id)
          }
        }
        for (const { storeName, entity } of entities) {
          await requestToPromise(
            transaction.objectStore(storeName).put(clone(entity)),
          )
        }
        return clone(validatedBundle)
      },
    )
  }

  private validateBundle(bundle: CoreRecordBundle): CoreRecordBundle {
    const parsed = parseCoreDataAggregate({
      problems: [bundle.problem],
      solutionSessions: [bundle.solutionSession],
      submissions: [],
      aiUsageRecords: [bundle.aiUsageRecord],
    })
    const aggregate = validated(parsed, 'core data bundle')
    const problem = aggregate.problems[0]
    const solutionSession = aggregate.solutionSessions[0]
    const aiUsageRecord = aggregate.aiUsageRecords[0]
    if (!problem || !solutionSession || !aiUsageRecord) {
      throw new CodeArchiveStorageError(
        'validation_error',
        'Core data bundle requires exactly one of each entity',
      )
    }
    return clone({ problem, solutionSession, aiUsageRecord })
  }

  private async getDatabase(): Promise<IDBDatabase> {
    if (this.database) return this.database
    if (!this.opening) {
      this.opening = openCodeArchiveDatabase(this.options)
        .then((database) => {
          this.database = database
          database.onversionchange = () => this.close()
          return database
        })
        .finally(() => {
          this.opening = undefined
        })
    }
    return this.opening
  }

  private async create<T extends StoredEntity>(
    storeName: CodeArchiveStoreName,
    entity: T,
  ): Promise<T> {
    const database = await this.getDatabase()
    return runTransaction(
      database,
      storeName,
      'readwrite',
      async (transaction) => {
        await this.addToStore(transaction.objectStore(storeName), entity)
        return clone(entity)
      },
    )
  }

  private async addToStore<T extends StoredEntity>(
    store: IDBObjectStore,
    entity: T,
  ): Promise<void> {
    try {
      await requestToPromise(store.add(clone(entity)))
    } catch (error) {
      if (
        error instanceof CodeArchiveStorageError &&
        error.cause instanceof DOMException &&
        error.cause.name === 'ConstraintError'
      ) {
        throw duplicateError(store.name as CodeArchiveStoreName, entity.id)
      }
      throw error
    }
  }

  private async get<T extends StoredEntity>(
    storeName: CodeArchiveStoreName,
    id: string,
  ): Promise<T | undefined> {
    const database = await this.getDatabase()
    return runTransaction(
      database,
      storeName,
      'readonly',
      async (transaction) => {
        const result = (await requestToPromise(
          transaction.objectStore(storeName).get(id),
        )) as T | undefined
        return result === undefined ? undefined : clone(result)
      },
    )
  }

  private async list<T extends StoredEntity>(
    storeName: CodeArchiveStoreName,
  ): Promise<T[]> {
    const database = await this.getDatabase()
    return runTransaction(
      database,
      storeName,
      'readonly',
      async (transaction) => {
        const results = (await requestToPromise(
          transaction.objectStore(storeName).getAll(),
        )) as T[]
        return clone(results)
      },
    )
  }

  private async update<T extends StoredEntity>(
    storeName: CodeArchiveStoreName,
    entity: T,
  ): Promise<T> {
    const database = await this.getDatabase()
    return runTransaction(
      database,
      storeName,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(storeName)
        const existing = await requestToPromise(store.getKey(entity.id))
        if (existing === undefined) throw notFoundError(storeName, entity.id)
        await requestToPromise(store.put(clone(entity)))
        return clone(entity)
      },
    )
  }
}
