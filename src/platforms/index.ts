import { resolvePlatformAdapter } from './common'
import { sweaAdapter } from './swea'

export * from './common'
export * from './swea'

export const platformAdapters = [sweaAdapter] as const

export function resolveRegisteredPlatformAdapter(url: URL) {
  return resolvePlatformAdapter(url, platformAdapters)
}
