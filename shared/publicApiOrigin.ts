/** Public, non-secret endpoints and extension identities shared by bundled clients. */
export const PUBLIC_API_ORIGIN = 'https://codearchive-api-stg-e3q54l32da-as.a.run.app'
export const STORE_EXTENSION_ID = 'mlhibjadcbklfdllkonhjjajhmhnoalj'
export const LEGACY_LOCAL_EXTENSION_ID = 'oohlcmihldmfninmdcmanddfmhoonmdl'
export const EXTENSION_ORIGINS = [
  `chrome-extension://${STORE_EXTENSION_ID}`,
  `chrome-extension://${LEGACY_LOCAL_EXTENSION_ID}`,
] as const
export const LEGACY_DASHBOARD_ORIGIN = 'https://codearchive-dashboard-beta.netlify.app'
export const LOCAL_DASHBOARD_ORIGIN = 'http://localhost:5173'
/** Relay hosts besides the API; the retired dashboard proxy is only migrated, never called. */
export const LEGACY_RELAY_ORIGINS = [LOCAL_DASHBOARD_ORIGIN] as const

export function isTrustedApiOrigin(value: string): boolean { return value === PUBLIC_API_ORIGIN }
export function isTrustedExtensionOrigin(value: string | null | undefined): boolean {
  return !!value && (EXTENSION_ORIGINS as readonly string[]).includes(value)
}
