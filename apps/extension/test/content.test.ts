import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { createCapture } from "../src/capture";
import {
  loadSweaProblemContext,
  loadSweaProblemContextForReferrer,
  storeCaptureWithRetry,
  startCapture,
  storeSweaProblemContext
} from "../src/content";
import { SWEA_CONTEXT_LOOKUP_ERROR } from "../src/sweaProblemContext";
import type { PlatformAdapter } from "../src/types";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

function capture() {
  const result = createCapture({
    platform: "SWEA",
    problemNumber: "1868",
    title: "파핑파핑 지뢰찾기",
    problemUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
    language: "Java",
    sourceCode: "class Solution {}",
    result: "ACCEPTED"
  });
  assert.ok(result);
  return result;
}

test("a submit click reports collecting immediately and clears a failed attempt", async () => {
  const { document } = parseHTML("<html><body><button id='submit'>제출</button></body></html>");
  const previousElement = globalThis.Element;
  const previousObserver = globalThis.MutationObserver;
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  let pending = false;
  const messages: Array<{ type: string; phase: string }> = [];
  const adapter: PlatformAdapter = {
    platform: "JUNGOL",
    detectProblem: () => ({ problemNumber: "1520", title: "테스트", problemUrl: "https://jungol.co.kr/problem/1520" }),
    detectSubmissionResult: () => null,
    detectEditor: () => null,
    collectPerformance: () => null,
    isSubmitControl: element => element.id === "submit",
    beginSubmissionAttempt: () => { pending = true; },
    hasPendingSubmissionAttempt: () => pending,
    consumeSubmissionResult: () => undefined
  };
  try {
    startCapture(adapter, document, async message => { messages.push(message as { type: string; phase: string }); return { ok: true }; });
    (document.querySelector("#submit") as HTMLButtonElement).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0]?.phase, "CAPTURING");
    pending = false;
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(messages.at(-1)?.phase, "CLEAR");
  } finally {
    Object.assign(globalThis, { Element: previousElement, MutationObserver: previousObserver });
  }
});

test("content capture retries transient worker failures and preserves the same payload", async () => {
  const delays: number[] = [];
  const messages: unknown[] = [];
  let calls = 0;
  const result = await storeCaptureWithRetry(
    capture(),
    async (message) => {
      messages.push(message);
      calls += 1;
      if (calls < 3) throw new Error("worker unavailable");
      return { ok: true };
    },
    async (delayMs) => { delays.push(delayMs); }
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 150]);
  assert.deepEqual(messages[0], messages[1]);
  assert.deepEqual(messages[1], messages[2]);
});

test("Jungol ignores list-page submit controls but starts collecting after SPA navigation to a problem", async () => {
  const { document } = parseHTML("<html><body><button id='submit'>제출</button></body></html>");
  const previousElement = globalThis.Element;
  const previousObserver = globalThis.MutationObserver;
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  const location = new URL("https://jungol.co.kr/problem");
  let pending = false;
  let begun = 0;
  const phases: string[] = [];
  const adapter: PlatformAdapter = {
    platform: "JUNGOL",
    detectProblem: () => location.pathname === "/problem/1073"
      ? { problemNumber: "1073", title: "삼각형둘레", problemUrl: location.href }
      : null,
    detectSubmissionResult: () => null,
    detectEditor: () => null,
    collectPerformance: () => null,
    isSubmitControl: element => element.id === "submit",
    beginSubmissionAttempt: () => { begun += 1; pending = true; },
    hasPendingSubmissionAttempt: () => pending,
    consumeSubmissionResult: () => undefined
  };
  try {
    startCapture(adapter, document, async message => {
      phases.push((message as { phase: string }).phase);
      return { ok: true };
    });
    (document.querySelector("#submit") as HTMLButtonElement).click();
    assert.equal(begun, 0);
    assert.deepEqual(phases, []);
    location.pathname = "/problem/1073";
    (document.querySelector("#submit") as HTMLButtonElement).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(begun, 1);
    assert.equal(phases[0], "CAPTURING");
    pending = false;
    await new Promise(resolve => setTimeout(resolve, 350));
  } finally {
    Object.assign(globalThis, { Element: previousElement, MutationObserver: previousObserver });
  }
});

test("an invalidated extension context stops retrying the old tab", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await storeCaptureWithRetry(capture(), () => {
    calls += 1;
    throw new Error("Extension context invalidated.");
  }, async delay => { delays.push(delay); });
  assert.equal(result, undefined);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("an invalidated content script stops observing and tells the user to refresh the problem tab", async () => {
  const { document } = parseHTML("<html><body><button id='submit'>제출</button></body></html>");
  const previousElement = globalThis.Element;
  const previousObserver = globalThis.MutationObserver;
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  let calls = 0;
  const adapter: PlatformAdapter = {
    platform: "JUNGOL",
    detectProblem: () => ({ problemNumber: "1520", title: "테스트", problemUrl: "https://jungol.co.kr/problem/1520" }),
    detectSubmissionResult: () => null,
    detectEditor: () => null,
    collectPerformance: () => null,
    isSubmitControl: element => element.id === "submit",
    beginSubmissionAttempt: () => undefined,
    hasPendingSubmissionAttempt: () => true,
    consumeSubmissionResult: () => undefined
  };
  try {
    startCapture(adapter, document, () => {
      calls += 1;
      throw new Error("Extension context invalidated.");
    });
    (document.querySelector("#submit") as HTMLButtonElement).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(document.querySelector("#codearchive-reload-required")?.textContent ?? "", /이 문제 탭을 새로고침/);
    assert.equal(calls, 1);
    (document.querySelector("#submit") as HTMLButtonElement).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, "a dead content script must not keep sending or polling");
  } finally {
    Object.assign(globalThis, { Element: previousElement, MutationObserver: previousObserver });
  }
});

test("accepted capture uses the supplied content-script channel for local storage", async () => {
  const { document } = parseHTML("<html><body><button id='submit'>제출</button></body></html>");
  const previousElement = globalThis.Element;
  const previousObserver = globalThis.MutationObserver;
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  const current = capture();
  const problem = { problemNumber: current.problemNumber, title: current.title, problemUrl: current.problemUrl };
  const editor = { language: current.language, sourceCode: current.sourceCode };
  let pending = false;
  const messages: Array<{ type: string }> = [];
  const adapter: PlatformAdapter = {
    platform: "SWEA",
    detectProblem: () => problem,
    detectSubmissionResult: () => pending ? { accepted: true, resultText: "PASS입니다.", element: document.body } : null,
    detectEditor: () => editor,
    collectPerformance: () => null,
    isSubmitControl: element => element.id === "submit",
    beginSubmissionAttempt: () => { pending = true; },
    getSubmissionSnapshot: () => ({ problem, editor }),
    hasPendingSubmissionAttempt: () => pending,
    consumeSubmissionResult: () => { pending = false; }
  };
  try {
    startCapture(adapter, document, async message => { messages.push(message as { type: string }); return { ok: true }; });
    (document.querySelector("#submit") as HTMLButtonElement).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.filter(message => message.type === "STORE_CAPTURE").length, 1);
    assert.equal(pending, false);
  } finally {
    Object.assign(globalThis, { Element: previousElement, MutationObserver: previousObserver });
  }
});

test("Java versions are stored as Java only after site verification", async () => {
  for (const language of ["Java 8", "Java 15", "JAVA15", "Java 17 (OpenJDK)"]) {
    const original = { ...capture(), language, languageKey: "java" };
    let stored: typeof original | undefined;
    await storeCaptureWithRetry(original, async message => {
      stored = (message as { capture: typeof original }).capture;
      return { ok: true };
    });
    assert.equal(original.language, language, "the submission's exact language remains available for verification");
    assert.equal(stored?.language, "Java");
    assert.equal(stored?.languageKey, "java");
  }
});

test("content capture stops after the bounded retry budget", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await storeCaptureWithRetry(
    capture(),
    async () => {
      calls += 1;
      return { ok: false, error: "STORAGE_ERROR" };
    },
    async (delayMs) => { delays.push(delayMs); }
  );

  assert.deepEqual(result, { ok: false, error: "STORAGE_ERROR" });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [50, 150, 500]);
});

test("detail-page content sends only a verified SWEA problem context", async () => {
  const { document } = parseHTML('<input id="contestProbId" value="A">');
  const messages: unknown[] = [];
  const stored = await storeSweaProblemContext(
    document,
    locationFor("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A"),
    async (message) => {
      messages.push(message);
      return { ok: true };
    },
    1_000
  );
  assert.equal(stored, true);
  assert.deepEqual(messages, [{
    type: "STORE_SWEA_PROBLEM_CONTEXT",
    context: {
      contestProbId: "A",
      problemUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A",
      sourcePath: "/main/code/problem/problemDetail.do",
      observedAt: 1_000
    }
  }]);

  let calls = 0;
  assert.equal(await storeSweaProblemContext(
    document,
    locationFor("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B"),
    async () => { calls += 1; return { ok: true }; }
  ), false);
  assert.equal(calls, 0);
});

test("solving-page content requests context by exact referrer", async () => {
  const sourceUrl = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=U1";
  const context = {
    contestProbId: "U1",
    problemUrl: sourceUrl,
    sourcePath: "/main/code/userProblem/userProblemDetail.do" as const,
    observedAt: 1_000
  };
  const messages: unknown[] = [];
  assert.deepEqual(await loadSweaProblemContext(sourceUrl, async (message) => {
    messages.push(message);
    return { context };
  }), context);
  assert.deepEqual(messages, [{ type: "GET_SWEA_PROBLEM_CONTEXT", sourceUrl }]);
});

test("solving-page context lookup distinguishes a genuine no-row from runtime or storage failures", async () => {
  const sourceUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A";
  assert.equal(await loadSweaProblemContext(sourceUrl, async () => ({ context: null, missing: true })), null);
  assert.equal(await loadSweaProblemContext(sourceUrl, async () => ({ context: null, error: "STORAGE_ERROR" })), SWEA_CONTEXT_LOOKUP_ERROR);
  assert.equal(await loadSweaProblemContext(sourceUrl, async () => { throw new Error("worker unavailable"); }), SWEA_CONTEXT_LOOKUP_ERROR);
});

test("SWEA query-less navigation referrers are missing context rather than failed lookups", async () => {
  let calls = 0;
  const send = async () => { calls += 1; return { context: null, error: "INVALID_SWEA_CONTEXT_LOOKUP" }; };
  for (const referrer of [
    "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do?userId=member",
    "https://swexpertacademy.com/main/code/problem/problemDetail.do",
    "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do",
    "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do"
  ]) {
    assert.equal(await loadSweaProblemContextForReferrer(referrer, send), null);
  }
  assert.equal(calls, 0);

  assert.equal(
    await loadSweaProblemContextForReferrer("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=", async () => {
      calls += 1;
      return { context: null, missing: true };
    }),
    SWEA_CONTEXT_LOOKUP_ERROR
  );
  assert.equal(calls, 0);
});
