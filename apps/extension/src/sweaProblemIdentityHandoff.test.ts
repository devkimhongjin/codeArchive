import { describe, expect, it } from "vitest";
import { createProblemContestIdHandoffStore, detailProblemContestId } from "./sweaProblemIdentityHandoff";

const detailUrl = new URL("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=from-url");
const solvingPath = "/main/solvingProblem/solvingProblem.do";

describe("SWEA Problem-family identity handoff", () => {
  it("reads the external field at the detail boundary and exposes the internal semantic name", () => {
    const document = new DOMParser().parseFromString('<input name="contestProbId" value="from-form">', "text/html");
    expect(detailProblemContestId(document, detailUrl)).toBe("from-form");
    expect(detailProblemContestId(new DOMParser().parseFromString("", "text/html"), detailUrl)).toBe("from-url");
  });

  it("is same-tab, one-shot, short-lived, and replaces newer Problem detail context", () => {
    let now = 1_000;
    const store = createProblemContestIdHandoffStore(() => now);
    expect(store.issue(7, "first")).toBe(true);
    expect(store.issue(7, "second")).toBe(true);
    expect(store.consume(8, "https://swexpertacademy.com", solvingPath)).toBeNull();
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath)).toBe("second");
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath)).toBeNull();

    expect(store.issue(7, "expired")).toBe(true);
    now += 60_001;
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath)).toBeNull();
  });

  it("rejects wrong origin and route without preserving the handoff", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    store.issue(7, "current");
    expect(store.consume(7, "https://example.com", solvingPath)).toBeNull();
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath)).toBeNull();
  });
});
