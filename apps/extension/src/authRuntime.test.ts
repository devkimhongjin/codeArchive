import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_LOGIN } from "./authMessages";

const authenticated = {
  status: "authenticated" as const,
  user: { id: "user-a", githubLogin: "tester", displayName: "Tester", avatarUrl: null },
  expiresAt: "2026-08-27T00:00:00Z",
};

afterEach(() => {
  vi.resetModules();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("popup auth runtime", () => {
  it("delegates login to the background using a non-sensitive runtime message", async () => {
    const sendMessage = vi.fn(async (message: unknown) => {
      expect(message).toEqual({ type: AUTH_LOGIN });
      return { ok: true, state: authenticated };
    });
    (globalThis as any).chrome = { runtime: { sendMessage } };

    const { codeArchiveAuthService } = await import("./authRuntime");
    await expect(codeArchiveAuthService.login()).resolves.toEqual(authenticated);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(JSON.stringify(sendMessage.mock.calls[0]?.[0])).not.toMatch(/code=|token|state|github\.com\/login/i);
  });

  it("maps the background-safe failure stage without exposing OAuth values", async () => {
    const response = { ok: false, error: "exchange" as const };
    (globalThis as any).chrome = { runtime: { sendMessage: vi.fn(async () => response) } };
    const { codeArchiveAuthService } = await import("./authRuntime");

    await expect(codeArchiveAuthService.login()).rejects.toMatchObject({
      name: "AuthLoginStageError",
      stage: "exchange",
    });
    expect(JSON.stringify(response)).toBe('{"ok":false,"error":"exchange"}');
    expect(JSON.stringify(response)).not.toMatch(/authorization|state=|code=|token|secret|github\.com\/login/i);
  });

  it("uses auth_failed when the background response is malformed", async () => {
    (globalThis as any).chrome = { runtime: { sendMessage: vi.fn(async () => null) } };
    const { codeArchiveAuthService } = await import("./authRuntime");
    await expect(codeArchiveAuthService.login()).rejects.toMatchObject({ stage: "auth_failed" });
  });
});
