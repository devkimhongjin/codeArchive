import { CODEARCHIVE_API_BASE_URL } from "./apiConfig";
import { AUTH_LOGIN, type AuthLoginResponse } from "./authMessages";
import { CodeArchiveAuthService, indexedDbAuthSessionStore, type ChromeIdentityBridge } from "./authSession";

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};

const delegatedIdentityBridge: ChromeIdentityBridge = {
  getRedirectURL() {
    throw new Error("Interactive auth is background-owned.");
  },
  launchWebAuthFlow() {
    return Promise.reject(new Error("Interactive auth is background-owned."));
  },
};

async function loginThroughBackground() {
  const response = await chrome.runtime.sendMessage({ type: AUTH_LOGIN }) as AuthLoginResponse;
  if (!response?.ok) throw new Error("Background auth failed.");
  return response.state;
}

export const codeArchiveAuthService = new CodeArchiveAuthService(
  CODEARCHIVE_API_BASE_URL,
  indexedDbAuthSessionStore,
  delegatedIdentityBridge,
  fetch,
  () => Date.now(),
  loginThroughBackground,
);
