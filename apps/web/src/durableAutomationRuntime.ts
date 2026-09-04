import type { CodeArchiveAutomationKind } from "../../../packages/shared-types/src";
import type { GitHubAutoTarget } from "./githubClient";
import type { DurableAutomationController } from "./durableAutomation";
import {
  durableAutomationProfile,
  markDurableLocalSourceStopped,
  setDurableAutomationProfile,
} from "./durableAutomationState";

export interface DurableGitHubConsent {
  readonly automaticTransferConsent: boolean;
  readonly visibilityRiskConsent: boolean;
  readonly publicUploadConsent: boolean;
}

let current: DurableAutomationController | null = null;

export function registerDurableAutomationController(controller: DurableAutomationController): () => void {
  current = controller;
  return () => { if (current === controller) current = null; };
}

export async function enableDurableGitHubAutoCommit(target: GitHubAutoTarget, consent: DurableGitHubConsent): Promise<boolean> {
  const controller = current;
  if (!controller) return false;
  const result = await controller.enableGitHubAutoCommit(target, consent);
  setDurableAutomationProfile(result.profile);
  return result.relayPaired && result.profile.githubAutoCommitEnabled;
}

export async function disableDurableGitHubAutoCommit(): Promise<boolean> {
  const controller = current;
  if (!controller) return false;
  const result = await controller.disableGitHubAutoCommit();
  setDurableAutomationProfile(result.profile);
  return !result.profile.githubAutoCommitEnabled;
}

export async function disableAllDurableAutomation(): Promise<boolean> {
  const controller = current;
  if (!controller) return false;
  markDurableLocalSourceStopped();
  const result = await controller.disableAll();
  setDurableAutomationProfile(result.profile, false);
  return !result.profile.sourceTransferEnabled && !result.profile.githubAutoCommitEnabled;
}

/**
 * Handle only explicit popup OFF requests for an already confirmed durable profile.
 * ON remains App/UI-authoritative because it needs fresh account consent and, for GitHub,
 * a freshly selected/revalidated target. Returns null when the legacy PAGE_OWNED path owns
 * the request.
 */
export async function handleExplicitDurableAutomationOff(
  automation: CodeArchiveAutomationKind,
  enabled: boolean,
): Promise<boolean | null> {
  const profile = durableAutomationProfile();
  if (enabled || profile?.ownershipMode !== "DURABLE_SERVER") return null;
  try {
    return automation === "AUTO_SYNC"
      ? await disableAllDurableAutomation()
      : await disableDurableGitHubAutoCommit();
  } catch {
    if (automation === "AUTO_SYNC") markDurableLocalSourceStopped();
    return false;
  }
}
