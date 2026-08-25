import { describe, expect, it } from "vitest";
import { formatKstDateTime } from "./displayTime";

describe("formatKstDateTime", () => {
  it("formats ISO timestamps in KST", () => {
    expect(formatKstDateTime("2026-08-24T12:00:00.000Z")).toBe("2026-08-24 21:00:00 KST");
  });

  it("leaves invalid values unchanged", () => {
    expect(formatKstDateTime("invalid")).toBe("invalid");
  });
});
