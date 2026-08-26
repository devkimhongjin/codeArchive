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

  it("maps a background login failure to a generic popup-safe error", async () => {
    (globalThis as any).chrome = { runtime: { sendMessage: vi.fn(async () => ({ ok: false, error: "auth_failed" })) } };
    const { codeArchiveAuthService } = await import("./authRuntime");
    await expect(codeArchiveAuthService.login()).rejects.toThrow("Background auth failed.");
  });
});
