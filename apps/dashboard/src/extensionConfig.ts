import { extensionRuntime } from './extensionEnvironment'
import { LEGACY_LOCAL_EXTENSION_ID, STORE_EXTENSION_ID } from '../../../shared/publicApiOrigin'
// Web/desktop compatibility uses the pinned public identity. A bundled page
// always talks only to the extension that owns its origin (also on the Web Store).
export const EXTENSION_ID = extensionRuntime()?.id ?? STORE_EXTENSION_ID
// Transitional allowlist for the owner's existing unpacked capture store.
export const LEGACY_EXTENSION_ID = LEGACY_LOCAL_EXTENSION_ID
export const EXTENSION_CANDIDATES = [EXTENSION_ID, LEGACY_EXTENSION_ID] as const
