import { describe, expect, it, vi } from "vitest";
import { CodeArchiveAuthService, type AuthSessionStore, type ChromeIdentityBridge } from "./authSession";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function memoryStore(initial: any = null): AuthSessionStore & { current(): any } {
  let value = initial;
  return {
    load: vi.fn(async () => value),
    save: vi.fn(async (next) => { value = next; }),
    clear: vi.fn(async () => { value = null; }),
    current: () => value,
  };
}

const identity: ChromeIdentityBridge = {
  getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/codearchive-auth"),
  launchWebAuthFlow: vi.fn(async () => "https://extension-id.chromiumapp.org/codearchive-auth#code=one-time-code"),
};

const me = { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: "https://example.com/avatar.png" };

describe("CodeArchiveAuthService", () => {
  it("does not launch interactive auth during restore", async () => {
    const store = memoryStore();
    const bridge = { ...identity, launchWebAuthFlow: vi.fn() };
    const service = new CodeArchiveAuthService("https://api.example.com", store, bridge, vi.fn());
    await expect(service.restore()).resolves.toEqual({ status: "signed_out" });
    expect(bridge.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("starts extension login only on explicit login, exchanges fragment code, and stores CodeArchive bearer identity", async () => {
    const store = memoryStore();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/extension-login")) return response({ success: true, data: { authorizationUrl: "https://github.com/login/oauth/authorize?state=x", expiresAt: "2026-08-26T01:00:00Z" } });
      if (path.endsWith("/exchange")) {
        expect(JSON.parse(String(init?.body))).toEqual({ code: "one-time-code" });
        return response({ success: true, data: { accessToken: "codearchive-bearer", expiresAt: "2026-08-26T03:00:00Z" } });
      }
      if (path.endsWith("/me")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer codearchive-bearer");
        return response({ success: true, data: me });
      }
      throw new Error("unexpected request");
    }) as typeof fetch;
    const bridge: ChromeIdentityBridge = {
      getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/codearchive-auth"),
      launchWebAuthFlow: vi.fn(async ({ interactive }) => {
        expect(interactive).toBe(true);
        return "https://extension-id.chromiumapp.org/codearchive-auth#code=one-time-code";
      }),
    };
    const service = new CodeArchiveAuthService("https://api.example.com", store, bridge, fetcher, () => new Date("2026-08-26T00:00:00Z").getTime());

    await expect(service.login()).resolves.toEqual({ status: "authenticated", user: me, expiresAt: "2026-08-26T03:00:00Z" });
    expect(store.current()).toEqual({ accessToken: "codearchive-bearer", expiresAt: "2026-08-26T03:00:00Z", user: me });
  });

  it("rejects a completion URL that is not the exact chrome identity redirect", async () => {
    const store = memoryStore();
    const bridge: ChromeIdentityBridge = {
      getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/codearchive-auth"),
      launchWebAuthFlow: vi.fn(async () => "https://attacker.example/codearchive-auth#code=stolen"),
    };
    const fetcher = vi.fn(async () => response({ success: true, data: { authorizationUrl: "https://github.com/login/oauth/authorize", expiresAt: "2026-08-26T01:00:00Z" } })) as typeof fetch;
    const service = new CodeArchiveAuthService("https://api.example.com", store, bridge, fetcher);
    await expect(service.login()).rejects.toThrow("Unexpected auth completion URL");
    expect(store.current()).toBeNull();
  });

  it("clears expired or rejected sessions without touching solution storage", async () => {
    const expired = memoryStore({ accessToken: "old", expiresAt: "2026-08-25T00:00:00Z" });
    const service = new CodeArchiveAuthService("https://api.example.com", expired, identity, vi.fn(), () => new Date("2026-08-26T00:00:00Z").getTime());
    await expect(service.restore()).resolves.toEqual({ status: "signed_out" });
    expect(expired.current()).toBeNull();
  });

  it("always clears the local bearer on logout even if server revoke fails", async () => {
    const store = memoryStore({ accessToken: "token", expiresAt: "2026-08-27T00:00:00Z", user: me });
    const service = new CodeArchiveAuthService("https://api.example.com", store, identity, vi.fn(async () => { throw new Error("offline"); }) as typeof fetch);
    await expect(service.logout()).resolves.toBeUndefined();
    expect(store.current()).toBeNull();
  });
});
