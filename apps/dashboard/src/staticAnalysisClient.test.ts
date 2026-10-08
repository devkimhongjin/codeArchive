// @vitest-environment jsdom
/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { runStaticAnalysis } from './staticAnalysisClient'
import { emptyAnalysis } from './staticAnalysisContract'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })
function worker() {
  const value = { onmessage: null as ((event: MessageEvent) => unknown) | null, onerror: null as ((event: ErrorEvent) => unknown) | null, postMessage: vi.fn(), terminate: vi.fn() }
  value.postMessage.mockImplementation(request => queueMicrotask(() => value.onmessage?.({ data: { id: request.id, result: emptyAnalysis('javascript', 'success') } } as MessageEvent)))
  return value
}
it('caches by source, language and analyzer version without retaining raw source', async () => {
  const first = worker(), next = worker(), source = 'const privateCacheFixture = 101;'
  expect((await runStaticAnalysis('JavaScript', source, { workerFactory: () => first })).cached).toBe(false)
  expect(first.terminate).toHaveBeenCalledTimes(1)
  expect((await runStaticAnalysis('javascript', source, { workerFactory: () => next })).cached).toBe(true)
  expect(next.postMessage).not.toHaveBeenCalled(); expect(JSON.stringify(localStorage)).not.toContain(source)
  await runStaticAnalysis('JavaScript', source + '\n', { workerFactory: () => next }); expect(next.postMessage).toHaveBeenCalledTimes(1)
})
it('terminates a worker on timeout and does not cache timeout results', async () => {
  const blocked = worker(); blocked.postMessage.mockImplementation(() => {})
  expect((await runStaticAnalysis('JavaScript', 'timeoutFixture1()', { workerFactory: () => blocked, timeoutMs: 5 })).result.status).toBe('timeout')
  expect(blocked.terminate).toHaveBeenCalledTimes(1)
  const next = worker(); expect((await runStaticAnalysis('JavaScript', 'timeoutFixture1()', { workerFactory: () => next })).cached).toBe(false)
})
it('terminates on selection cancellation and ignores stale messages', async () => {
  const blocked = worker(), controller = new AbortController(); blocked.postMessage.mockImplementation(() => controller.abort())
  await expect(runStaticAnalysis('JavaScript', 'cancelFixture1()', { workerFactory: () => blocked, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(blocked.terminate).toHaveBeenCalledTimes(1)
  const next = worker(); expect((await runStaticAnalysis('JavaScript', 'cancelFixture1()', { workerFactory: () => next })).cached).toBe(false)
})
it('does not accept a response from another request or language', async () => {
  const invalid = worker(); invalid.postMessage.mockImplementation(request => queueMicrotask(() => {
    invalid.onmessage?.({ data: { id: request.id + 1, result: emptyAnalysis('javascript', 'success') } } as MessageEvent)
    invalid.onmessage?.({ data: { id: request.id, result: emptyAnalysis('python', 'success') } } as MessageEvent)
  }))
  expect((await runStaticAnalysis('JavaScript', 'invalidFixture1()', { workerFactory: () => invalid })).result.status).toBe('failed')
})
