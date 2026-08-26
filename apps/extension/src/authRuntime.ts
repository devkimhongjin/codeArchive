import { CODEARCHIVE_API_BASE_URL } from "./apiConfig";
import { CodeArchiveAuthService, indexedDbAuthSessionStore, type ChromeIdentityBridge } from "./authSession";

declare const chrome: {
  identity: {
    getRedirectURL(path?: string): string;
    launchWebAuthFlow(options: { url: string; interactive: boolean }): Promise<string>;
  };
};

export const chromeIdentityBridge: ChromeIdentityBridge = {
  getRedirectURL(path) {
    return chrome.identity.getRedirectURL(path);
  },
  launchWebAuthFlow(options) {
    return chrome.identity.launchWebAuthFlow(options);
  },
};

export const codeArchiveAuthService = new CodeArchiveAuthService(
  CODEARCHIVE_API_BASE_URL,
  indexedDbAuthSessionStore,
  chromeIdentityBridge,
);
