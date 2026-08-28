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

type FetchOverride = Response | Error;

function successfulFetcher(overrides: Partial<Record<"login_start" | "health" | "exchange" | "me", FetchOverride>> = {}): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/extension-login")) {
      const override = overrides.login_start;
      if (override instanceof Error) throw override;
      return override ?? response({ success: true, data: { authorizationUrl: "https://github.com/login/oauth/authorize?state=fixture", expiresAt: "2026-08-26T01:00:00Z" } });
    }
    if (path === "/actuator/health") {
      const override = overrides.health;
      if (override instanceof Error) throw override;
      return override ?? response({ status: "UP" });
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
    expect(fetcher).not.toHaveBeenCalledWith("https://api.example.com/actuator/health", expect.anything());
  });

  it("classifies missing runtime host access before fetch", async () => {
    const fetcher = successfulFetcher();
    const bridge: ChromeIdentityBridge = { ...identity, hasHostAccess: vi.fn(async () => false) };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, fetcher);

    await expectStage(service.login(), "login_start_host_access");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("classifies host access API failure without retaining runtime details", async () => {
    const bridge: ChromeIdentityBridge = {
      ...identity,
      hasHostAccess: vi.fn(async () => { throw new Error("sensitive runtime detail"); }),
    };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, successfulFetcher());
    await expectStage(service.login(), "login_start_host_access");
  });

  it("classifies login-start rejection as origin-level when the same-origin health probe also rejects", async () => {
    const fetcher = successfulFetcher({
      login_start: new Error("state=private original network detail"),
      health: new Error("token=private health network detail"),
    });
    const bridge: ChromeIdentityBridge = { ...identity, launchWebAuthFlow: vi.fn() };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, fetcher);

    await expectStage(service.login(), "login_start_fetch_origin");
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://api.example.com/api/v1/auth/github/extension-login", {
      method: "GET",
      cache: "no-store",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenNthCalledWith(4, "https://api.example.com/actuator/health", {
      method: "GET",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(bridge.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("classifies login-start rejection as request-specific when the same origin still returns an HTTP response", async () => {
    const fetcher = successfulFetcher({
      login_start: new Error("state=private original network detail"),
      health: response({ private: "body is intentionally ignored" }, 503),
    });
    const bridge: ChromeIdentityBridge = { ...identity, launchWebAuthFlow: vi.fn() };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, fetcher);

    await expectStage(service.login(), "login_start_fetch_request");
    expect(fetcher).toHaveBeenNthCalledWith(4, "https://api.example.com/actuator/health", {
      method: "GET",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(bridge.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("continues OAuth when a transient login-start fetch rejection recovers", async () => {
    let loginAttempts = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/extension-login") && ++loginAttempts < 3) throw new Error("transient network rejection");
      if (path.endsWith("/extension-login")) {
        return response({ success: true, data: { authorizationUrl: "https://github.com/login/oauth/authorize?state=fixture", expiresAt: "2026-08-26T01:00:00Z" } });
      }
      if (path.endsWith("/exchange")) return response({ success: true, data: { accessToken: "access", expiresAt: "2026-08-27T00:00:00Z" } });
      return response({ success: true, data: me });
    }) as typeof fetch;
    const bridge: ChromeIdentityBridge = { ...identity, launchWebAuthFlow: vi.fn(identity.launchWebAuthFlow) };
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, fetcher);

    await expect(service.login()).resolves.toMatchObject({ status: "authenticated" });
    expect(loginAttempts).toBe(3);
    expect(bridge.launchWebAuthFlow).toHaveBeenCalledOnce();
  });

  it("bounds a health probe that never settles after login-start rejection", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        if (new URL(String(url)).pathname.endsWith("/extension-login")) throw new Error("network detail");
        return new Promise<Response>(() => undefined);
      }) as typeof fetch;
      const bridge: ChromeIdentityBridge = { ...identity, launchWebAuthFlow: vi.fn() };
      const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), bridge, fetcher);

      const login = service.login();
      const expectedStage = expectStage(login, "login_start_fetch_origin");
      await vi.advanceTimersByTimeAsync(5_000);

      await expectedStage;
      expect(bridge.launchWebAuthFlow).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies extension-login HTTP non-success separately", async () => {
    const service = new CodeArchiveAuthService(
      "https://api.example.com",
      memoryStore(),
      identity,
      successfulFetcher({ login_start: response({ error: "provider body must stay private" }, 503) }),
    );
    await expectStage(service.login(), "login_start_http");
  });

  it("classifies extension-login JSON parsing failure separately", async () => {
    const malformed = new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } });
    const service = new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ login_start: malformed }));
    await expectStage(service.login(), "login_start_json");
  });

  it("classifies extension-login API envelope validation failure separately", async () => {
    const service = new CodeArchiveAuthService(
      "https://api.example.com",
      memoryStore(),
      identity,
      successfulFetcher({ login_start: response({ success: true, data: { expiresAt: "2026-08-26T01:00:00Z" } }) }),
    );
    await expectStage(service.login(), "login_start_envelope");
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

    try {
      await service.login();
      throw new Error("expected login failure");
    } catch (caught) {
      expect(caught).toBeInstanceOf(AuthLoginStageError);
      const error = caught as AuthLoginStageError;
      expect(error.stage).toBe("web_auth_launch");
      expect(JSON.stringify({ name: error.name, message: error.message, stage: error.stage })).not.toMatch(/state=|code=|token|github\.com\/login/i);
    }
  });

  it("login-start substage errors expose only fixed safe labels", async () => {
    const cases: Array<[string, CodeArchiveAuthService]> = [
      ["login_start_fetch_origin", new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ login_start: new Error("state=private"), health: new Error("token=private") }))],
      ["login_start_fetch_request", new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ login_start: new Error("state=private"), health: response({ raw: "token=private" }, 500) }))],
      ["login_start_http", new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ login_start: response({ raw: "token=private" }, 500) }))],
      ["login_start_json", new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, vi.fn(async () => new Response("code=private", { status: 200 })) as typeof fetch)],
      ["login_start_envelope", new CodeArchiveAuthService("https://api.example.com", memoryStore(), identity, successfulFetcher({ login_start: response({ success: false, data: { authorizationUrl: "https://github.com/login/oauth/authorize?state=private" } }) }))],
    ];

    for (const [stage, service] of cases) {
      try {
        await service.login();
        throw new Error("expected login failure");
      } catch (caught) {
        expect(caught).toBeInstanceOf(AuthLoginStageError);
        const error = caught as AuthLoginStageError;
        expect(error.stage).toBe(stage);
        expect(JSON.stringify({ name: error.name, message: error.message, stage: error.stage })).not.toMatch(/authorization|state=|code=|token|secret|github\.com\/login/i);
      }
    }
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
