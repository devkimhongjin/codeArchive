import { describe, expect, it } from "vitest";
import { createProblemContestIdHandoffStore, detailProblemContestId } from "./sweaProblemIdentityHandoff";

const detailUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A";
const detailUrlB = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B";
const solvingOrigin = "https://swexpertacademy.com";
const solvingPath = "/main/solvingProblem/solvingProblem.do";

describe("SWEA Problem-family identity handoff", () => {
  it("reads the external field at the detail boundary and exposes the internal semantic name", () => {
    const document = new DOMParser().parseFromString('<input name="contestProbId" value="from-form">', "text/html");
    expect(detailProblemContestId(document, new URL(detailUrl))).toBe("from-form");
    expect(detailProblemContestId(new DOMParser().parseFromString("", "text/html"), new URL(detailUrl))).toBe("A");
  });

  it("creates one pending handoff and allows exact cross-tab consumption within the TTL", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(store.size()).toBe(0);
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
  });

  it("gives same-tab consumption no privilege beyond the exact provenance checks", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    expect(store.consume(7, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    expect(store.consume(7, solvingOrigin, solvingPath, `${detailUrl}#different`)).toBeNull();
    expect(store.consume(7, solvingOrigin, solvingPath, detailUrl)).toBe("A");
  });

  it("replaces the previous pending context globally and retains at most one", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    expect(store.issue(9, "B", detailUrlB)).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrlB)).toBe("B");
    expect(store.size()).toBe(0);
  });

  it("accepts the exact 60-second boundary and rejects 60,001 milliseconds", () => {
    let now = 1_000;
    const store = createProblemContestIdHandoffStore(() => now);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    now += 60_000;
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    now += 60_001;
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
    expect(store.size()).toBe(0);
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
  });

  it("rejects missing, malformed, mismatched, duplicate, and empty referrer identities", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    for (const referrer of [
      "", "not-a-url", "https://swexpertacademy.com/main/code/problem/problemDetail.do",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A&contestProbId=A",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=",
    ]) expect(store.consume(8, solvingOrigin, solvingPath, referrer)).toBeNull();
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
  });

  it("rejects wrong origin, solving route, Problem-detail route, and invalid source URL", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    expect(store.consume(8, "https://example.com", solvingPath, detailUrl)).toBeNull();
    expect(store.consume(8, solvingOrigin, "/wrong", detailUrl)).toBeNull();
    expect(store.consume(8, solvingOrigin, solvingPath, "https://swexpertacademy.com/wrong?contestProbId=A")).toBeNull();
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(store.issue(7, "A", "not-a-url")).toBe(false);
    expect(store.issue(7, "A", "https://example.com/main/code/problem/problemDetail.do?contestProbId=A")).toBe(false);
    expect(store.issue(7, "A", "https://swexpertacademy.com/main/code/problem/other.do?contestProbId=A")).toBe(false);
  });

  it("requires issue-time source contestProbId to equal the internal problemContestId", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    expect(store.issue(7, "B", detailUrl)).toBe(false);
    expect(store.issue(7, "A", "https://swexpertacademy.com/main/code/problem/problemDetail.do")).toBe(false);
    expect(store.issue(7, "A", "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A&contestProbId=A")).toBe(false);
    expect(store.issue(7, "A", "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=")).toBe(false);
    expect(store.size()).toBe(0);
  });

  it("keeps expiry cleanup and successful consumption one-shot", () => {
    let now = 1_000;
    const store = createProblemContestIdHandoffStore(() => now);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    now += 60_001;
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
    expect(store.size()).toBe(0);
    expect(store.issue(7, "A", detailUrl)).toBe(true);
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(store.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
  });

  it("has no pending identity after the handoff store is recreated", () => {
    const original = createProblemContestIdHandoffStore(() => 1_000);
    expect(original.issue(7, "A", detailUrl)).toBe(true);
    const recreated = createProblemContestIdHandoffStore(() => 1_000);
    expect(recreated.size()).toBe(0);
    expect(recreated.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
  });
});
