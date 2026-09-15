import type { Capture } from './types'

export type RuntimeApi = {
  lastError?: { message?: string }
  sendMessage: (extensionId: string, message: unknown, callback?: (response: unknown) => void) => unknown
}

export class BridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}

type BrowserWindow = Window & { chrome?: { runtime?: RuntimeApi } }

function runtimeFromWindow(): RuntimeApi | undefined {
  return (window as BrowserWindow).chrome?.runtime
}

export function requestBridge<T extends object>(
  extensionId: string,
  message: Record<string, unknown>,
  options: { runtime?: RuntimeApi; timeoutMs?: number } = {},
): Promise<T> {
  const runtime = options.runtime ?? runtimeFromWindow()
  if (!runtime?.sendMessage) return Promise.reject(new BridgeError('Chrome 확장 프로그램 API를 찾을 수 없습니다.'))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const timeout = setTimeout(
      () => finish(() => reject(new BridgeError('확장 프로그램 응답 시간이 초과되었습니다.'))),
      options.timeoutMs ?? 4000,
    )
    const handleResponse = (response: unknown) => {
      const runtimeError = runtime.lastError?.message
      if (runtimeError) {
        finish(() => reject(new BridgeError(runtimeError)))
        return
      }
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        finish(() => reject(new BridgeError('확장 프로그램 응답이 올바르지 않습니다.')))
        return
      }
      const payload = response as Record<string, unknown>
      const bridgeError = payload.error
      if (typeof bridgeError === 'string' && bridgeError.trim()) {
        finish(() => reject(new BridgeError(bridgeError.trim())))
        return
      }
      finish(() => resolve(payload as T))
    }
    try {
      const maybePromise = runtime.sendMessage(extensionId, message, handleResponse)
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        ;(maybePromise as Promise<unknown>).then(handleResponse, (error) =>
          finish(() => reject(error instanceof Error ? error : new BridgeError('확장 프로그램 요청에 실패했습니다.'))),
        )
      }
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new BridgeError('확장 프로그램 요청에 실패했습니다.')))
    }
  })
}

function recordPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BridgeError('확장 프로그램 응답이 올바르지 않습니다.')
  }
  return payload as Record<string, unknown>
}

export function parseConnectResponse(payload: unknown): { capability: string } {
  const record = recordPayload(payload)
  if (typeof record.capability !== 'string' || !record.capability.trim()) {
    throw new BridgeError('확장 프로그램 capability가 없습니다.')
  }
  return { capability: record.capability }
}

export function parsePendingResponse(payload: unknown): { captures: Capture[] } {
  const record = recordPayload(payload)
  if (!Array.isArray(record.captures)) throw new BridgeError('확장 프로그램 captures 응답이 올바르지 않습니다.')
  return { captures: record.captures as Capture[] }
}

export function parseAckResponse(payload: unknown): { ok: true } {
  const record = recordPayload(payload)
  if (record.ok !== true) throw new BridgeError('확장 프로그램 ACK가 승인되지 않았습니다.')
  return { ok: true }
}
