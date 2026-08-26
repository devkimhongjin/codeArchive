import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";

const BETA_EXTENSION_ID = "oohlcmihldmfninmdcmanddfmhoonmdl";
const BETA_REDIRECT_URI = `https://${BETA_EXTENSION_ID}.chromiumapp.org/codearchive-auth`;
const BETA_DEVELOPMENT_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs1JHCF0j2ffxu+7w813jXP/BZ9nO8xydrdbbk3PTDrU3Z1iCCswGvuJ7fvWYkYqgC98aFGVz++l1GxSLjnNw8WQUvkvWXezTZgMV1BHAR9QJJGSaXbaA91VduV2Fti2nMh6Fy0g0Y03sdEVMoxMq/JdkpwrNQ6b5wNi2FCATRKzdAPThc84cag7y/q/cpq81+mkSf2lXmX8VjOCsk94Lff/B2s3HY3xcBlp5gUsqn7b6idlpxkol0a1+LOxPD3z3C+KeOtuqWcPsDf5Mxb+fY8ntusnVmI9ByghPzCTYbCL+DzH6YSbdLp/acJwUS47KxMorfLEdzyA2Dqvt1KrjpQIDAQAB";

describe("extension manifest", () => {
  it("injects the SWEA content script on ContestProblem detail pages", () => {
    const matches = manifest.content_scripts.flatMap((script) => script.matches);
    expect(matches).toContain("https://swexpertacademy.com/main/code/contestProblem/contestProblemDetail.do*");
  });

  it("grants only Chrome identity while the Main API host remains owner-gated", () => {
    expect(manifest.permissions).toEqual(["identity"]);
    expect("host_permissions" in manifest).toBe(false);
  });

  it("pins the public development key used by the unpacked beta", () => {
    expect(manifest.key).toBe(BETA_DEVELOPMENT_KEY);
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(BETA_EXTENSION_ID).toMatch(/^[a-p]{32}$/);
    expect(BETA_REDIRECT_URI).toBe("https://oohlcmihldmfninmdcmanddfmhoonmdl.chromiumapp.org/codearchive-auth");
  });
});
