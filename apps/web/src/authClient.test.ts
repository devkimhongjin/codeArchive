import { describe, expect, it, vi } from "vitest";
import { createDashboardAuthClient, DASHBOARD_LOGIN_URL, MAIN_API_ORIGIN } from "./authClient";

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Dashboard auth client", () => {
  it("discovers /me with cookie credentials and parses safe account data", async () => {
    const fetcher = vi.fn(async () => response(200, {
      success: true,
      data: {
        id: "internal-id",
        githubUserId: 123,
        githubLogin: "octocat",
        displayName: "Octo Cat",
        avatarUrl: "https://avatars.example/octo.png",
      },
      error: null,
      requestId: "request-id",
    }));
    const result = await createDashboardAuthClient(fetcher).discoverSession();
    expect(fetcher).toHaveBeenCalledWith(`${MAIN_API_ORIGIN}/api/v1/me`, {
      method: "GET",
      credentials: "include",
    });
    expect(result).toEqual({
      status: "authenticated",
      user: { githubLogin: "octocat", displayName: "Octo Cat", avatarUrl: "https://avatars.example/octo.png" },
    });
    expect(fetcher.mock.calls.flat().join(" ")).not.toContain("/auth/exchange");
  });

  it("maps 401 to signed out and network/server failures to unavailable", async () => {
    expect(await createDashboardAuthClient(async () => response(401)).discoverSession()).toEqual({ status: "signed_out" });
    expect(await createDashboardAuthClient(async () => response(503)).discoverSession()).toEqual({ status: "unavailable" });
    expect(await createDashboardAuthClient(async () => { throw new Error("raw secret detail"); }).discoverSession()).toEqual({ status: "unavailable" });
  });

  it("uses exact top-level login navigation without fetching login", () => {
    const fetcher = vi.fn();
    const navigate = vi.fn();
    createDashboardAuthClient(fetcher, navigate).login();
    expect(navigate).toHaveBeenCalledWith(DASHBOARD_LOGIN_URL);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("runs teardown hook before POST logout with cookie credentials", async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      order.push("api");
      expect(String(url)).toBe(`${MAIN_API_ORIGIN}/api/v1/auth/logout`);
      expect(init).toEqual({ method: "POST", credentials: "include" });
      return response(200, { success: true, data: { revoked: true } });
    });
    const ok = await createDashboardAuthClient(fetcher).logout(async () => { order.push("teardown"); });
    expect(ok).toBe(true);
    expect(order).toEqual(["teardown", "api"]);
  });
});
