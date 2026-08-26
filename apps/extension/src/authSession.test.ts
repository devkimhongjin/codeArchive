import { describe, expect, it, vi } from "vitest";
import { AuthLoginStageError } from "./authDiagnostics";
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

function successfulFetcher(overrides: Partial<Record<"login_start" | "exchange" | "me", Response | Error>> = {}): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/extension-login")) {
      const override = overrides.login_start;
      if (override instanceof Error) throw override;
      return override ?? response({ success: true, data: { authorizationUrl: "https://github.com/login/oauth/authorize?state=fixture", expiresAt: "2026-08-26T01:00:00Z" } });
    }
    if (path.endsWith("/exchange")) {
      expect(JSON.parse(String(init?.body))).toEqual({ code: "one-time-code" });
      const override = overrides.exchange;
      if (override instanceof Error) throw override;
      return override ?? response({ success: true, data: { accessToken: "codearchive-bearer", expiresAt: "2026-08-26T03:00:00Z" } });
    }
    if (path.endsWith("/me")) {
      const override = overrides.me;
      if (override instanceof Error) throw override;
      return override ?? response({ success: true, data: me });
    }
    throw new Error("unexpected request");
  }) as typeof fetch;
}

async function expectStage(promise: Promise<unknown>, stage: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "AuthLoginStageError", stage });
}

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
    const fetcher = successfulFetcher();
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

  it("classifies extension-login request/envelope failures as login_start", async () => {
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ login_start: response({ success: false, data: null }, 503) }));
    await expectStage(service.login(), "login_start");
  });

  it("classifies launchWebAuthFlow rejection as web_auth_launch", async () => {
    const bridge: ChromeIdentityBridge = {
      getRedirectURL: identity.getRedirectURL,
      launchWebAuthFlow: vi.fn(async () => { throw new Error("provider window rejected with sensitive details"); }),
    };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, successfulFetcher());
    await expectStage(service.login(), "web_auth_launch");
  });

  it("classifies exact redirect mismatch or missing one-time code as callback_validation", async () => {
    const bridge: ChromeIdentityBridge = {
      getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/codearchive-auth"),
      launchWebAuthFlow: vi.fn(async () => "https://attacker.example/codearchive-auth#code=secret"),
    };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, successfulFetcher());
    await expectStage(service.login(), "callback_validation");
  });

  it("classifies exchange request/envelope/session failures as exchange", async () => {
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ exchange: response({ success: false, data: null }, 502) }));
    await expectStage(service.login(), "exchange");
  });

  it("classifies authenticated identity lookup failures as me", async () => {
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ me: response({ success: false, data: null }, 500) }));
    await expectStage(service.login(), "me");
  });

  it("stage errors contain only the safe stage and do not retain underlying OAuth values", async () => {
    const sensitive = "https://github.com/login/oauth/authorize?state=secret&code=secret-token";
    const bridge: ChromeIdentityBridge = {
      getRedirectURL: identity.getRedirectURL,
      launchWebAuthFlow: vi.fn(async () => { throw new Error(sensitive); }),
    };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, successfulFetcher());

    const error = await service.login().catch((caught) => caught as AuthLoginStageError);
    expect(error).toBeInstanceOf(AuthLoginStageError);
    expect(error.stage).toBe("web_auth_launch");
    expect(JSON.stringify({ name: error.name, message: error.message, stage: error.stage })).not.toMatch(/state=|code=|token|github\.com\/login/i);
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
