import { describe, expect, it } from "vitest";
import { BETA_CODEARCHIVE_API_BASE_URL, CODEARCHIVE_API_BASE_URL } from "./apiConfig";

describe("beta API config", () => {
  it("uses the deployed Main API origin when no manual override is supplied", () => {
    expect(BETA_CODEARCHIVE_API_BASE_URL).toBe("https://codearchive-api.onrender.com");
    expect(CODEARCHIVE_API_BASE_URL).toBe("https://codearchive-api.onrender.com");
  });
});
