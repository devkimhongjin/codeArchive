import type { GitHubAutoTarget } from "./githubClient";
import type { DurableAutomationController } from "./durableAutomation";
import { setDurableAutomationProfile } from "./durableAutomationState";

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
  const result = await controller.disableAll();
  setDurableAutomationProfile(result.profile, false);
  return !result.profile.sourceTransferEnabled && !result.profile.githubAutoCommitEnabled;
}
