import { describe, expect, it } from 'vitest'
import { BridgeError, parseAckResponse, parseConnectResponse, parsePendingResponse, parseRelayReuseResponse, requestBridge } from './bridge'
import { requestIsCurrent } from './requestFence'
import { acceptedIdsForAck } from './syncLogic'

describe('extension bridge contract', () => {
  it('rejects an extension error response', async () => {
    const runtime = { sendMessage: (_id: string, _message: unknown, callback?: (response: unknown) => void) => callback?.({ error: 'UNAUTHORIZED' }) }
    await expect(requestBridge('a'.repeat(32), { type: 'CONNECT' }, { runtime })).rejects.toThrow('UNAUTHORIZED')
  })

  it('requires a non-empty CONNECT capability', () => {
    expect(() => parseConnectResponse({})).toThrow(BridgeError)
    expect(() => parseConnectResponse({ capability: '' })).toThrow('capability')
    expect(parseConnectResponse({ capability: 'cap-123' })).toEqual({ capability: 'cap-123' })
  })

  it('requires captures and a positive ACK response', () => {
    expect(() => parsePendingResponse({ captures: 'not-an-array' })).toThrow('captures')
    expect(() => parseAckResponse({ ok: false })).toThrow('ACK')
    expect(parseAckResponse({ ok: true })).toEqual({ ok: true })
  })

  it('requires an explicit boolean relay reuse response', () => {
    expect(parseRelayReuseResponse({ reused: true })).toEqual({ reused: true })
    expect(parseRelayReuseResponse({ reused: false })).toEqual({ reused: false })
    expect(() => parseRelayReuseResponse({ ok: true })).toThrow('릴레이 상태')
  })

  it('only ACKs server-accepted IDs from the current pending page', () => {
    expect(acceptedIdsForAck(['one', 'old', 42, 'one'], ['one', 'two'])).toEqual(['one'])
    expect(acceptedIdsForAck({ accepted: ['one'] }, ['one'])).toEqual([])
  })

  it('does not commit a deferred list after logout invalidates its fence', async () => {
    let resolveList!: (value: string[]) => void
    const deferredList = new Promise<string[]>((resolve) => { resolveList = resolve })
    const fence = { generation: 0, operation: 1 }
    let generation = 0
    let operation = 1
    let committed: string[] = []
    const pendingCommit = deferredList.then((list) => {
      if (requestIsCurrent(fence, generation, operation)) committed = list
    })

    generation += 1 // logout/resetBridge
    resolveList(['private-old-record'])
    await pendingCommit
    expect(committed).toEqual([])
  })
})
