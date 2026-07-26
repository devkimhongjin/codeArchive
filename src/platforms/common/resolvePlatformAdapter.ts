import {
  adapterFailure,
  type AdapterResult,
  type PlatformAdapter,
} from './PlatformAdapter'

export function resolvePlatformAdapter(
  url: URL,
  adapters: readonly PlatformAdapter[],
): AdapterResult<PlatformAdapter> {
  const adapter = adapters.find((candidate) => candidate.supports(url))
  if (adapter) return { ok: true, value: adapter }

  return adapterFailure({
    code: 'unsupported-url',
    stage: 'detect',
    message: 'No registered platform adapter supports this URL.',
    recoverable: false,
    fallback: 'manual-entry',
  })
}

export function resolvePlatformAdapterFromString(
  rawUrl: string,
  adapters: readonly PlatformAdapter[],
): AdapterResult<PlatformAdapter> {
  try {
    return resolvePlatformAdapter(new URL(rawUrl), adapters)
  } catch {
    return adapterFailure({
      code: 'unsupported-url',
      stage: 'detect',
      message: 'The page URL is not a valid absolute URL.',
      recoverable: false,
      fallback: 'manual-entry',
    })
  }
}
