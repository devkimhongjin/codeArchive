import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import type {
  AdapterResult,
  PlatformAdapter,
} from '../../../src/platforms/common'
import {
  resolvePlatformAdapter,
  resolvePlatformAdapterFromString,
} from '../../../src/platforms/common'
import { sweaAdapter } from '../../../src/platforms/swea'

interface FixtureCase {
  fixture: string
  url: string
  expected: string
}

interface FixtureMetadata {
  synthetic: boolean
  containsRealSiteContent: boolean
  purpose: string
  cases: FixtureCase[]
  unsupportedUrls: string[]
  updatePolicy: string
}

class FakeElement {
  textContent: string | null

  constructor(textContent: string | null) {
    this.textContent = textContent
  }
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = []

  readonly callback: () => void
  observeCalls = 0
  disconnectCalls = 0

  constructor(callback: () => void) {
    this.callback = callback
    FakeMutationObserver.instances.push(this)
  }

  observe(): void {
    this.observeCalls += 1
  }

  disconnect(): void {
    this.disconnectCalls += 1
  }

  emit(): void {
    this.callback()
  }
}

class FakeDocument {
  readonly source: string
  queryCount = 0
  readonly defaultView = {
    MutationObserver: FakeMutationObserver,
  }

  constructor(source: string) {
    this.source = source
  }

  querySelector(selector: string): FakeElement | null {
    this.queryCount += 1
    const attribute = selector.match(/^\[([a-z0-9-]+)\]$/i)?.[1]
    if (!attribute) return null

    const escapedAttribute = attribute.replaceAll('-', '\\-')
    const element = this.source.match(
      new RegExp(
        `<[^>]*\\s${escapedAttribute}(?=\\s|=|>)(?:=(?:"[^"]*"|'[^']*'))?[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
        'i',
      ),
    )
    if (!element) return null

    const textContent = element[1].replaceAll(/<[^>]+>/g, '').trim()
    return new FakeElement(textContent)
  }
}

function fixturePath(name: string): string {
  return fileURLToPath(
    new URL(`../../fixtures/platforms/swea/${name}`, import.meta.url),
  )
}

function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8')
}

function metadata(): FixtureMetadata {
  return JSON.parse(readFixture('cases.json')) as FixtureMetadata
}

function context(name: string, rawUrl?: string) {
  const source = readFixture(name)
  const selected = metadata().cases.find(({ fixture }) => fixture === name)
  if (!selected && !rawUrl) throw new Error(`Missing metadata for ${name}`)
  const document = new FakeDocument(source)
  return {
    source,
    document,
    adapterContext: {
      url: new URL(rawUrl ?? selected?.url),
      document: document as unknown as Document,
    },
  }
}

function failureOf<T>(result: AdapterResult<T>) {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected adapter failure')
  return result.error
}

describe('platform adapter resolver', () => {
  it('selects registered adapters and returns structured unsupported failures', () => {
    const supported = resolvePlatformAdapter(new URL(metadata().cases[0].url), [
      sweaAdapter,
    ])
    expect(supported).toMatchObject({
      ok: true,
      value: { platform: 'swea' },
    })

    for (const rawUrl of metadata().unsupportedUrls) {
      const result = resolvePlatformAdapterFromString(rawUrl, [sweaAdapter])
      expect(failureOf(result)).toMatchObject({
        code: 'unsupported-url',
        stage: 'detect',
        recoverable: false,
        fallback: 'manual-entry',
      })
    }
  })

  it('does not require or read a Document for unsupported URLs', () => {
    const spyAdapter: PlatformAdapter = {
      platform: 'swea',
      supports: () => false,
      captureProblem: () => {
        throw new Error('captureProblem must not be called')
      },
      captureSolution: () => {
        throw new Error('captureSolution must not be called')
      },
      observeSubmission: () => {
        throw new Error('observeSubmission must not be called')
      },
    }

    expect(
      failureOf(
        resolvePlatformAdapter(
          new URL('https://example.invalid/problems/SYN-0000'),
          [spyAdapter],
        ),
      ),
    ).toMatchObject({ code: 'unsupported-url', fallback: 'manual-entry' })
  })
})

describe('SWEA adapter fixture contract', () => {
  beforeEach(() => {
    FakeMutationObserver.instances = []
  })

  it('captures a normal synthetic problem and Java solution without mutating input', () => {
    const fixture = context('normal.html')
    const before = fixture.source

    const problem = sweaAdapter.captureProblem(fixture.adapterContext)
    expect(problem).toMatchObject({
      ok: true,
      value: {
        platform: 'swea',
        platformProblemId: 'SYN-1206',
        problemNumber: 'SYN-1206',
        title: '합성 보기 문제',
        difficulty: 'Mock D3',
        tags: ['array', 'simulation'],
        url: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?problem=SYN-1206',
      },
    })

    const solution = sweaAdapter.captureSolution(fixture.adapterContext)
    expect(solution).toMatchObject({
      ok: true,
      value: {
        code: 'class SyntheticSolution {}',
        language: 'java',
      },
    })
    expect(fixture.document.source).toBe(before)
  })

  it('keeps optional fields absent and returns a structured warning', () => {
    const fixture = context('optional-missing.html')
    const problem = sweaAdapter.captureProblem(fixture.adapterContext)

    expect(problem).toMatchObject({
      ok: true,
      value: {
        problemNumber: 'SYN-2001',
        title: '선택 필드 없는 합성 문제',
        tags: [],
      },
      warnings: [
        {
          code: 'optional-field-missing',
          stage: 'problem',
          fields: ['difficulty', 'tags'],
        },
      ],
    })
    if (problem.ok) {
      expect(problem.value.difficulty).toBeUndefined()
      expect(problem.value.tags).not.toContain('')
    }
  })

  it('maps Python and rejects an unknown language without guessing', () => {
    const python = context('optional-missing.html')
    expect(sweaAdapter.captureSolution(python.adapterContext)).toMatchObject({
      ok: true,
      value: { language: 'python' },
    })

    const unknownSource = python.source.replace('Python 3', 'SyntheticLang')
    const unknownDocument = new FakeDocument(unknownSource)
    const unknown = sweaAdapter.captureSolution({
      ...python.adapterContext,
      document: unknownDocument as unknown as Document,
    })
    expect(failureOf(unknown)).toMatchObject({
      code: 'language-unresolved',
      stage: 'language',
      recoverable: true,
      fallback: 'manual-entry',
      missingFields: ['language'],
    })
  })

  it('returns code-unavailable independently from a successful problem capture', () => {
    const fixture = context('code-missing.html')
    const problem = sweaAdapter.captureProblem(fixture.adapterContext)
    const solution = sweaAdapter.captureSolution(fixture.adapterContext)

    expect(problem).toMatchObject({
      ok: true,
      value: {
        problemNumber: 'SYN-3001',
        title: '코드 없는 합성 문제',
      },
    })
    expect(failureOf(solution)).toEqual({
      code: 'code-unavailable',
      stage: 'solution',
      message: 'Solution code is not available for capture.',
      recoverable: true,
      fallback: 'manual-entry',
      missingFields: ['code'],
    })
  })

  it('returns dom-contract-changed instead of an empty successful problem', () => {
    const fixture = context('dom-changed.html')
    expect(
      failureOf(sweaAdapter.captureProblem(fixture.adapterContext)),
    ).toEqual({
      code: 'dom-contract-changed',
      stage: 'problem',
      message: 'The page does not expose the expected capture contract.',
      recoverable: true,
      fallback: 'manual-entry',
    })
  })

  it('emits accepted, wrong-answer and unknown results on observer setup', () => {
    const cases = [
      ['normal.html', 'accepted'],
      ['optional-missing.html', 'wrong-answer'],
    ] as const

    for (const [name, expected] of cases) {
      const fixture = context(name)
      const emitted: string[] = []
      const observed = sweaAdapter.observeSubmission(
        fixture.adapterContext,
        ({ result }) => emitted.push(result),
      )
      expect(observed.ok).toBe(true)
      expect(emitted).toEqual([expected])
    }

    const fixture = context('normal.html')
    const source = fixture.source.replace('accepted', 'synthetic-pending')
    const document = new FakeDocument(source)
    const emitted: string[] = []
    const observed = sweaAdapter.observeSubmission(
      {
        ...fixture.adapterContext,
        document: document as unknown as Document,
      },
      ({ result }) => emitted.push(result),
    )
    expect(observed.ok).toBe(true)
    expect(emitted).toEqual(['unknown'])
  })

  it('observes changes and disconnects idempotently', () => {
    const fixture = context('normal.html')
    const emitted: string[] = []
    const result = sweaAdapter.observeSubmission(
      fixture.adapterContext,
      ({ result: submissionResult }) => emitted.push(submissionResult),
    )

    expect(result.ok).toBe(true)
    expect(FakeMutationObserver.instances).toHaveLength(1)
    const observer = FakeMutationObserver.instances[0]
    expect(observer.observeCalls).toBe(1)
    expect(emitted).toEqual(['accepted'])

    observer.emit()
    expect(emitted).toEqual(['accepted', 'accepted'])

    if (!result.ok) throw new Error('Expected observer success')
    result.value.disconnect()
    result.value.disconnect()
    expect(observer.disconnectCalls).toBe(1)
  })

  it('returns a manual fallback when submission observation is unavailable', () => {
    const fixture = context('code-missing.html')
    expect(
      failureOf(
        sweaAdapter.observeSubmission(fixture.adapterContext, () => undefined),
      ),
    ).toMatchObject({
      code: 'submission-observer-unavailable',
      stage: 'submission',
      recoverable: true,
      fallback: 'manual-entry',
      missingFields: ['submissionResult'],
    })
  })

  it('declares every fixture synthetic and free of real site content', () => {
    const fixtureMetadata = metadata()
    expect(fixtureMetadata.synthetic).toBe(true)
    expect(fixtureMetadata.containsRealSiteContent).toBe(false)
    expect(fixtureMetadata.cases).toHaveLength(4)
    expect(fixtureMetadata.purpose).toContain('TASK-0002')
    expect(fixtureMetadata.updatePolicy).toContain('synthetic')
  })
})
