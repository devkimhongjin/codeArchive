import type { DurableAutomationProfile } from "./durableAutomationClient";

let current: DurableAutomationProfile | null = null;
const listeners = new Set<(profile: DurableAutomationProfile | null) => void>();

export function durableAutomationProfile(): DurableAutomationProfile | null {
  return current;
}

export function setDurableAutomationProfile(profile: DurableAutomationProfile | null): void {
  current = profile;
  for (const listener of listeners) listener(profile);
}

export function subscribeDurableAutomationProfile(listener: (profile: DurableAutomationProfile | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
