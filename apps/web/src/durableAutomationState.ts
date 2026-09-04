import type { DurableAutomationProfile } from "./durableAutomationClient";

let current: DurableAutomationProfile | null = null;
let localSourceStopped = false;
const listeners = new Set<(profile: DurableAutomationProfile | null) => void>();

export function durableAutomationProfile(): DurableAutomationProfile | null {
  return current;
}

export function durableSourceTransferEffective(): boolean {
  return current?.ownershipMode === "DURABLE_SERVER" && current.sourceTransferEnabled && !localSourceStopped;
}

export function markDurableLocalSourceStopped(): void {
  localSourceStopped = true;
}

export function setDurableAutomationProfile(profile: DurableAutomationProfile | null, activateLocalSource = true): void {
  current = profile;
  if (profile?.ownershipMode === "DURABLE_SERVER" && profile.sourceTransferEnabled) {
    if (activateLocalSource) localSourceStopped = false;
  } else localSourceStopped = true;
  for (const listener of listeners) listener(profile);
}

export function subscribeDurableAutomationProfile(listener: (profile: DurableAutomationProfile | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
