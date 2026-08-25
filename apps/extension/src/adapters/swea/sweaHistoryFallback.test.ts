import { describe, expect, it } from "vitest";
import {
  cacheSweaFamilyContext,
  discoverSweaHistoryUrl,
  familyFromReferrer,
  readCachedSweaFamilyContext,
  trustedFamilyContext,
} from "./sweaHistoryFallback";

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

describe("SWEA history fallback discovery", () => {
  it("classifies only exact same-origin detail referrers", () => {
    expect(familyFromReferrer("https://swexpertacademy.com/main/code/problem/problemDetail.do?id=x")).toBe("Problem");
    expect(familyFromReferrer("https://swexpertacademy.com/main/code/contestProblem/contestProblemDetail.do?id=x")).toBe("ContestProblem");
    expect(familyFromReferrer("https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?id=x")).toBe("UserProblem");
    expect(familyFromReferrer("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do")).toBeNull();
    expect(familyFromReferrer("https://example.com/main/code/userProblem/userProblemDetail.do")).toBeNull();
    expect(familyFromReferrer("https://swexpertacademy.com/main/code/userProblem/other.do")).toBeNull();
  });

  it("caches family context only for the matching contestProbId", () => {
    const storage = memoryStorage();
    const context = trustedFamilyContext("https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current", "current");
    expect(context).not.toBeNull();
    cacheSweaFamilyContext(storage, context!);
    expect(readCachedSweaFamilyContext(storage, "current")).toEqual(context);
    expect(readCachedSweaFamilyContext(storage, "other")).toBeNull();
  });

  it("discovers the evidence-backed UserProblem solver href with matching identity", () => {
    const detailUrl = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current";
    const document = documentFrom(`
      <a href="/main/code/userProblem/userProblemDetail.do?contestProbId=current">문제</a>
      <a href="/main/code/userProblem/userProblemSolver.do?contestProbId=current">답안 이력</a>
    `);
    expect(discoverSweaHistoryUrl(document, detailUrl, "UserProblem")).toBe(
      "https://swexpertacademy.com/main/code/userProblem/userProblemSolver.do?contestProbId=current",
    );
  });

  it("rejects UserProblem solver candidates with a different contestProbId", () => {
    const detailUrl = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current";
    const document = documentFrom(`
      <a href="/main/code/userProblem/userProblemSolver.do?contestProbId=other">답안 이력</a>
    `);
    expect(discoverSweaHistoryUrl(document, detailUrl, "UserProblem")).toBeNull();
  });

  it("fails closed for missing, multiple, or wrong-family history links", () => {
    const detailUrl = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current";
    expect(discoverSweaHistoryUrl(documentFrom("<main/>"), detailUrl, "UserProblem")).toBeNull();
    expect(discoverSweaHistoryUrl(documentFrom(`
      <a href="/main/code/userProblem/userProblemSolver.do?contestProbId=current&view=a">답안 A</a>
      <a href="/main/code/userProblem/userProblemSolver.do?contestProbId=current&view=b">답안 B</a>
    `), detailUrl, "UserProblem")).toBeNull();
    expect(discoverSweaHistoryUrl(documentFrom(`
      <a href="/main/code/problem/problemSubmitHistory.do?contestProbId=current">제출 이력</a>
    `), detailUrl, "UserProblem")).toBeNull();
  });
});
