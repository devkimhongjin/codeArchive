import { describe, expect, it } from "vitest";
describe("background capture validation", () => {
  it("rejects malformed capture payloads before persistence", async () => {
    const chrome = { runtime: { onMessage: { addListener: () => undefined } } }; (globalThis as any).chrome = chrome;
    const { valid } = await import("./background");
    expect(valid({})).toBe(false);
    expect(valid({ captureId: "x", platform: "SWEA", result: "ACCEPTED" })).toBe(false);
  });
});
