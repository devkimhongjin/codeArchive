import { describe, expect, it } from "vitest";
import { readCachedSweaFamilyContext } from "../adapters/swea/sweaHistoryFallback";
import { seedSweaFamilyContext } from "./sweaFamilyContextSeed";

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

const solvingUrl = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");
const solvingDocument = () => documentFrom(`
  <div class="problem_box"><h3>1234. Synthetic title</h3></div>
  <input id="contestProbId" value="current">
`);

describe("seedSweaFamilyContext", () => {
  it("caches exact UserProblem family context immediately on solving-page initialization", () => {
    const storage = memoryStorage();
    const referrer = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current";

    expect(seedSweaFamilyContext(solvingDocument(), solvingUrl, referrer, storage)).toEqual({
      family: "UserProblem",
      referrerUrl: referrer,
      contestProbId: "current",
    });
    expect(readCachedSweaFamilyContext(storage, "current")).toMatchObject({ family: "UserProblem" });
  });

  it("does not seed from solving, unknown, or cross-origin referrers", () => {
    for (const referrer of [
      "",
      "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current",
      "https://example.com/main/code/userProblem/userProblemDetail.do?contestProbId=current",
      "https://swexpertacademy.com/main/code/userProblem/other.do?contestProbId=current",
    ]) {
      const storage = memoryStorage();
      expect(seedSweaFamilyContext(solvingDocument(), solvingUrl, referrer, storage)).toBeNull();
      expect(readCachedSweaFamilyContext(storage, "current")).toBeNull();
    }
  });

  it("rejects a cached context when a different contestProbId is requested", () => {
    const storage = memoryStorage();
    const referrer = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current";
    seedSweaFamilyContext(solvingDocument(), solvingUrl, referrer, storage);

    expect(readCachedSweaFamilyContext(storage, "other")).toBeNull();
  });

  it.each([
    ["Problem", "/main/code/problem/problemDetail.do"],
    ["ContestProblem", "/main/code/contestProblem/contestProblemDetail.do"],
    ["UserProblem", "/main/code/userProblem/userProblemDetail.do"],
  ] as const)("pre-seeds %s only from its exact detail page", (family, path) => {
    const storage = memoryStorage();
    const url = new URL(`https://swexpertacademy.com${path}?contestProbId=current`);
    const document = documentFrom('<input name="contestProbId" value="current">');

    expect(seedSweaFamilyContext(document, url, "", storage)).toEqual({
      family,
      referrerUrl: url.href,
      contestProbId: "current",
    });
    expect(readCachedSweaFamilyContext(storage, "current")).toMatchObject({ family });
  });

  it("fails closed when detail URL and DOM contestProbId disagree", () => {
    const storage = memoryStorage();
    const url = new URL("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=current");
    const document = documentFrom('<input name="contestProbId" value="other">');

    expect(seedSweaFamilyContext(document, url, "", storage)).toBeNull();
    expect(readCachedSweaFamilyContext(storage, "current")).toBeNull();
  });
});
