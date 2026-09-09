import { describe, expect, it } from "vitest";
import {
  createProblemContestIdHandoffStore,
  detailProblemContestId,
  type ProblemContestIdContextPersistence,
  type ProblemContestIdHandoff,
} from "./sweaProblemIdentityHandoff";

const detailUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A";
const detailUrlB = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B";
const solvingOrigin = "https://swexpertacademy.com";
const solvingPath = "/main/solvingProblem/solvingProblem.do";

class MemoryPersistence implements ProblemContestIdContextPersistence {
  value: unknown | null = null;
  async read(): Promise<unknown | null> { return this.value; }
  async write(context: ProblemContestIdHandoff): Promise<void> { this.value = { ...context }; }
}

function store(now: () => number = () => 1_000, persistence = new MemoryPersistence()) {
  return createProblemContestIdHandoffStore(now, persistence);
}

describe("SWEA Problem-family identity context", () => {
  it("reads the external field at the detail boundary and exposes the internal semantic name", () => {
    const document = new DOMParser().parseFromString('<input name="contestProbId" value="from-form">', "text/html");
    expect(detailProblemContestId(document, new URL(detailUrl))).toBe("from-form");
    expect(detailProblemContestId(new DOMParser().parseFromString("", "text/html"), new URL(detailUrl))).toBe("A");
  });

  it("keeps the trusted context across 60 seconds and 60 minutes instead of expiring it", async () => {
    let now = 1_000;
    const current = store(() => now);
    expect(await current.issue(7, "A", detailUrl)).toBe(true);
    now += 60_000;
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    now += 60 * 60_000;
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(await current.size()).toBe(1);
  });

  it("does not make a successful solving-page resolution one-shot", async () => {
    const current = store();
    expect(await current.issue(7, "A", detailUrl)).toBe(true);
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(await current.size()).toBe(1);
  });

  it("replaces A with the newer trusted B context and rejects stale A attribution", async () => {
    const current = store();
    expect(await current.issue(7, "A", detailUrl)).toBe(true);
    expect(await current.issue(9, "B", detailUrlB)).toBe(true);
    expect(await current.size()).toBe(1);
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrlB)).toBe("B");
  });

  it("survives store/service-worker reconstruction through persisted context", async () => {
    const persistence = new MemoryPersistence();
    const original = store(() => 1_000, persistence);
    expect(await original.issue(7, "A", detailUrl)).toBe(true);

    const reconstructed = store(() => 9_999_999, persistence);
    expect(await reconstructed.size()).toBe(1);
    expect(await reconstructed.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
  });

  it("gives same-tab resolution no privilege beyond exact provenance checks", async () => {
    const current = store();
    expect(await current.issue(7, "A", detailUrl)).toBe(true);
    expect(await current.consume(7, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(await current.consume(7, solvingOrigin, solvingPath, `${detailUrl}#different`)).toBeNull();
    expect(await current.consume(7, solvingOrigin, solvingPath, detailUrl)).toBe("A");
  });

  it("rejects missing, malformed, mismatched, duplicate, and empty referrer identities", async () => {
    const current = store();
    expect(await current.issue(7, "A", detailUrl)).toBe(true);
    for (const referrer of [
      "", "not-a-url", "https://swexpertacademy.com/main/code/problem/problemDetail.do",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A&contestProbId=A",
      "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=",
    ]) expect(await current.consume(8, solvingOrigin, solvingPath, referrer)).toBeNull();
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
  });

  it("rejects wrong origin, solving route, Problem-detail route, and invalid source URL", async () => {
    const current = store();
    expect(await current.issue(7, "A", detailUrl)).toBe(true);
    expect(await current.consume(8, "https://example.com", solvingPath, detailUrl)).toBeNull();
    expect(await current.consume(8, solvingOrigin, "/wrong", detailUrl)).toBeNull();
    expect(await current.consume(8, solvingOrigin, solvingPath, "https://swexpertacademy.com/wrong?contestProbId=A")).toBeNull();
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBe("A");
    expect(await current.issue(7, "A", "not-a-url")).toBe(false);
    expect(await current.issue(7, "A", "https://example.com/main/code/problem/problemDetail.do?contestProbId=A")).toBe(false);
    expect(await current.issue(7, "A", "https://swexpertacademy.com/main/code/problem/other.do?contestProbId=A")).toBe(false);
  });

  it("requires issue-time source contestProbId to equal the internal problemContestId", async () => {
    const current = store();
    expect(await current.issue(7, "B", detailUrl)).toBe(false);
    expect(await current.issue(7, "A", "https://swexpertacademy.com/main/code/problem/problemDetail.do")).toBe(false);
    expect(await current.issue(7, "A", "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A&contestProbId=A")).toBe(false);
    expect(await current.issue(7, "A", "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=")).toBe(false);
    expect(await current.size()).toBe(0);
  });

  it("fails closed for malformed persisted context instead of trusting stale storage", async () => {
    const persistence = new MemoryPersistence();
    persistence.value = {
      problemContestId: "A",
      issuedAt: 1_000,
      sourceOrigin: "https://swexpertacademy.com",
      sourcePath: "/main/code/problem/problemDetail.do",
      sourceUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B",
    };
    const current = store(() => 1_000, persistence);
    expect(await current.size()).toBe(0);
    expect(await current.consume(8, solvingOrigin, solvingPath, detailUrl)).toBeNull();
  });
});
