import { fetchLatestExtensionRelease, isVersionAtLeast, trustedExtensionRelease, type ExtensionReleaseInfo } from '../../../shared/extensionRelease';

export const EXTENSION_UPDATE_KEY = 'codearchive-extension-update-v1';
const DAY = 24 * 60 * 60 * 1000;
export interface ExtensionUpdateState {
  installedVersion: string;
  checkedAt: number;
  status: 'checked' | 'unavailable';
  release: ExtensionReleaseInfo | null;
  available: boolean;
}
type Storage = { get: () => Promise<unknown>; set: (value: ExtensionUpdateState) => Promise<void> };

export function createExtensionUpdateChecker(installedVersion: string, storage: Storage, fetcher: typeof fetch = fetch, now = Date.now) {
  let inFlight: Promise<ExtensionUpdateState> | null = null;
  const check = (force = false): Promise<ExtensionUpdateState> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const cached = await storage.get().catch(() => null) as Partial<ExtensionUpdateState> | null;
      const release = trustedExtensionRelease(cached?.release);
      const checkedAt = typeof cached?.checkedAt === 'number' && Number.isFinite(cached.checkedAt) ? cached.checkedAt : 0;
      const age = now() - checkedAt;
      const validStatus = cached?.status === 'checked' || cached?.status === 'unavailable';
      if (validStatus && cached?.installedVersion === installedVersion && age >= 0 && age < (force ? 60_000 : cached.status === 'unavailable' ? 5 * 60_000 : DAY) &&
          (cached.status === 'unavailable' || release)) {
        return { installedVersion, checkedAt, status: cached.status!, release, available: !!release && release.version !== installedVersion && isVersionAtLeast(release.version, installedVersion) };
      }
      let result: ExtensionUpdateState;
      try {
        // Notification only: a newer release remains visible even if it requires
        // a newer dashboard. ZIP files are never downloaded or executed here.
        const latest = await fetchLatestExtensionRelease(fetcher, 5000, null);
        result = { installedVersion, checkedAt: now(), status: 'checked', release: latest,
          available: latest.version !== installedVersion && isVersionAtLeast(latest.version, installedVersion) };
      } catch {
        result = { installedVersion, checkedAt: now(), status: 'unavailable', release,
          available: !!release && release.version !== installedVersion && isVersionAtLeast(release.version, installedVersion) };
      }
      await storage.set(result).catch(() => undefined);
      return result;
    })().finally(() => { inFlight = null });
    return inFlight;
  };
  return check;
}
