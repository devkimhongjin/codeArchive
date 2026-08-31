import { beforeEach, describe, expect, it, vi } from "vitest";
import { BETA_ENTRY_KEY, createEntryCheck, tabEntry } from "./betaEntry";
import { MAIN_API_ORIGIN } from "./authClient";

function response(status: number, body: unknown = null) {
  return new Response(JSON.stringify(body), { status });
}

describe("beta entry password check", () => {
  beforeEach(() => sessionStorage.clear());

  it("sends the password only in the POST body without auth credentials", async () => {
    const fetcher = vi.fn(async () => response(200, { success: true, data: { accepted: true } }));
    expect(await createEntryCheck(fetcher)("synthetic-test-password")).toBe("accepted");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${MAIN_API_ORIGIN}/api/v1/beta/access`, {
      method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "synthetic-test-password" }), signal: expect.any(AbortSignal),
    });
    expect(sessionStorage.length).toBe(0);
  });

  it.each([null, {}, { success: false, data: { accepted: true } }, { success: true, data: {} },
    { success: true, data: { accepted: "true" } }])("rejects malformed success: %j", async (body) => {
    expect(await createEntryCheck(async () => response(200, body))("test")).toBe("unavailable");
  });

  it("distinguishes wrong password from missing configuration or network error", async () => {
    expect(await createEntryCheck(async () => response(403))("test")).toBe("incorrect");
    expect(await createEntryCheck(async () => response(503))("test")).toBe("unavailable");
    expect(await createEntryCheck(async () => { throw new Error("secret detail"); })("test")).toBe("unavailable");
  });

  it("honors cancellation and does not retry the POST", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const result = createEntryCheck(fetcher)("test", controller.signal);
    controller.abort();
    expect(await result).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stores only the acceptance flag in tab storage", () => {
    expect(tabEntry.accepted()).toBe(false);
    tabEntry.remember();
    expect(tabEntry.accepted()).toBe(true);
    expect(sessionStorage.getItem(BETA_ENTRY_KEY)).toBe("accepted");
    expect(sessionStorage.length).toBe(1);
    sessionStorage.clear();
    expect(tabEntry.accepted()).toBe(false);
  });

  it("tolerates blocked session storage", () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(tabEntry.accepted()).toBe(false);
    expect(() => tabEntry.remember()).not.toThrow();
    read.mockRestore();
    write.mockRestore();
  });
});
