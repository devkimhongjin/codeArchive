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
    const firstUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=first";
    const secondUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=second";
    expect(store.issue(7, "first", firstUrl)).toBe(true);
    expect(store.issue(7, "second", secondUrl)).toBe(true);
    expect(store.consume(8, "https://swexpertacademy.com", solvingPath, secondUrl)).toBe("second");
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath, secondUrl)).toBeNull();
    expect(store.issue(7, "second", secondUrl)).toBe(true);
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath, secondUrl)).toBe("second");
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath, secondUrl)).toBeNull();

    expect(store.issue(7, "expired", firstUrl)).toBe(true);
    now += 60_001;
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath, firstUrl)).toBeNull();
  });

  it("rejects wrong origin and route without preserving the handoff", () => {
    const store = createProblemContestIdHandoffStore(() => 1_000);
    const sourceUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=current";
    store.issue(7, "current", sourceUrl);
    expect(store.consume(7, "https://example.com", solvingPath, sourceUrl)).toBeNull();
    expect(store.consume(7, "https://swexpertacademy.com", "/wrong", sourceUrl)).toBeNull();
    expect(store.consume(7, "https://swexpertacademy.com", solvingPath, sourceUrl)).toBe("current");
  });
});
