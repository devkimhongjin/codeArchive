import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import { parseHTML } from "linkedom";
import { SweaAdapter } from "../src/adapters/swea";
import { IndexedDbCaptureStore } from "../src/storage";
import {
  createSweaCanonicalProblemUrl,
  createSweaProblemContext,
  readSweaContestProbId,
  resolveSweaProblem,
  resolveSweaProblemUrl,
  SWEA_CONTEXT_LOOKUP_ERROR
} from "../src/sweaProblemContext";

const NORMAL_DETAIL = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A";
const USER_DETAIL = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=U1";
const USER_SUBMISSIONS = "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do?userId=member";
const QUERYLESS_DETAIL = "https://swexpertacademy.com/main/code/problem/problemDetail.do";
const QUERYLESS_SOLVING = "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

function problemDocument(contestProbId: string, extra = "") {
  return parseHTML(`<input id="contestProbId" value="${contestProbId}">${extra}`);
}

test("canonical SWEA links accept only one safe contest problem ID", () => {
  assert.equal(createSweaCanonicalProblemUrl(" AWrDOdQqRCUDFARG "), "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=AWrDOdQqRCUDFARG");
  assert.equal(createSweaCanonicalProblemUrl("A/B"), null);
  assert.equal(createSweaCanonicalProblemUrl(""), null);
});

test("normal and user detail pages preserve their verified original URLs", () => {
  const normal = createSweaProblemContext(problemDocument("A").document, locationFor(NORMAL_DETAIL), 1_000);
  const user = createSweaProblemContext(problemDocument("U1").document, locationFor(USER_DETAIL), 2_000);

  assert.deepEqual(normal, {
    contestProbId: "A",
    problemUrl: NORMAL_DETAIL,
    sourcePath: "/main/code/problem/problemDetail.do",
    observedAt: 1_000
  });
  assert.deepEqual(user, {
    contestProbId: "U1",
    problemUrl: USER_DETAIL,
    sourcePath: "/main/code/userProblem/userProblemDetail.do",
    observedAt: 2_000
  });
});

test("detail context rejects missing, duplicate, and conflicting identities", () => {
  assert.equal(createSweaProblemContext(problemDocument("").document, locationFor(NORMAL_DETAIL)), null);
  assert.equal(createSweaProblemContext(problemDocument("B").document, locationFor(NORMAL_DETAIL)), null);
  assert.equal(
    createSweaProblemContext(
      problemDocument("A", '<input name="contestProbId" value="B">').document,
      locationFor(NORMAL_DETAIL)
    ),
    null
  );
  assert.equal(
    createSweaProblemContext(problemDocument("A").document, locationFor(`${NORMAL_DETAIL}&contestProbId=A`)),
    null
  );
});

test("query-less solving page resolves an exact persisted source across a new page and long wait", () => {
  const sourceDocument = problemDocument("A").document;
  const context = createSweaProblemContext(sourceDocument, locationFor(NORMAL_DETAIL), 1_000);
  assert.ok(context);

  // A newly created Document models a different page/tab. observedAt is
  // intentionally old because verified problem context has no TTL.
  const { document } = parseHTML('<div class="problem_box"><h3>7206. 숫자 게임</h3></div><input id="contestProbId" value="A">');
  const resolved = resolveSweaProblemUrl(document, locationFor(QUERYLESS_SOLVING), NORMAL_DETAIL, {
    ...context,
    observedAt: context.observedAt - 3_600_000
  });
  assert.equal(resolved, NORMAL_DETAIL);

  const adapter = new SweaAdapter(document, locationFor(QUERYLESS_SOLVING), undefined, undefined, resolved);
  assert.deepEqual(adapter.detectProblem(), {
    problemNumber: "7206",
    title: "숫자 게임",
    problemUrl: NORMAL_DETAIL
  });
});

test("query-less solving capture retains validated identity when canonical source enrichment is unavailable", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>7206. 숫자 게임</h3></div><input id="contestProbId" value="A">');
  const adapter = new SweaAdapter(document, locationFor(QUERYLESS_SOLVING));
  assert.deepEqual(adapter.detectProblem(), {
    problemNumber: "7206",
    title: "숫자 게임",
    problemUrl: NORMAL_DETAIL
  });
});

test("live SWEA POST pages recover one problem ID from the exact bootstrap call", () => {
  const detail = parseHTML(`
    <input id="contestProbId" value="">
    <input name="contestProbId" value="">
    <script>$(document).ready(function () { checkFirstOpenProblem('AWrDOdQqRCUDFARG'); });</script>
  `).document;
  const solving = parseHTML(`
    <input id="contestProbId" value="">
    <script>checkIsFirstOpen('AWrDOdQqRCUDFARG', 'AWrDOdQqRCUDFARG', 'CODE');</script>
  `).document;

  assert.equal(readSweaContestProbId(detail), "AWrDOdQqRCUDFARG");
  assert.equal(readSweaContestProbId(solving), "AWrDOdQqRCUDFARG");
  assert.equal(readSweaContestProbId(parseHTML(`
    <input id="contestProbId" value="OTHER">
    <script>checkIsFirstOpen('AWrDOdQqRCUDFARG', 'AWrDOdQqRCUDFARG', 'CODE');</script>
  `).document), null);
  assert.equal(readSweaContestProbId(parseHTML(`
    <script>checkIsFirstOpen('A', 'B', 'CODE');</script>
  `).document), null);
});

test("query-less solving page reached from the My Page submission list uses validated local fallback", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>7733. 치즈 도둑</h3></div><input id="contestProbId" value="AWrDOdQqRCUDFARG">');
  const resolution = resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), USER_SUBMISSIONS, null);
  assert.deepEqual(resolution, { kind: "missing", problemUrl: null });
  assert.deepEqual(
    new SweaAdapter(document, locationFor(QUERYLESS_SOLVING), undefined, undefined, resolution.problemUrl, true).detectProblem(),
    { problemNumber: "7733", title: "치즈 도둑", problemUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=AWrDOdQqRCUDFARG" }
  );
});

test("query-less solving page reached through SWEA's POST detail route uses validated local fallback", () => {
  const { document } = parseHTML(`<div class="problem_box"><h3>7733. 치즈 도둑</h3></div>
    <input id="contestProbId" value="">
    <script>checkIsFirstOpen('AWrDOdQqRCUDFARG', 'AWrDOdQqRCUDFARG', 'CODE');</script>`);
  const resolution = resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), QUERYLESS_DETAIL, null);
  assert.deepEqual(resolution, { kind: "missing", problemUrl: null });
  assert.deepEqual(
    new SweaAdapter(document, locationFor(QUERYLESS_SOLVING), undefined, undefined, resolution.problemUrl, true).detectProblem(),
    { problemNumber: "7733", title: "치즈 도둑", problemUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=AWrDOdQqRCUDFARG" }
  );
});

test("query-less fallback is allowed only for missing context and not conflicting context", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>7206. 숫자 게임</h3></div><input id="contestProbId" value="A">');
  const missing = resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), "", null);
  assert.equal(missing.kind, "missing");
  assert.deepEqual(new SweaAdapter(document, locationFor(QUERYLESS_SOLVING), undefined, undefined, missing.problemUrl, true).detectProblem()?.problemNumber, "7206");
  const conflicting = resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), NORMAL_DETAIL, {
    contestProbId: "B", problemUrl: NORMAL_DETAIL.replace("A", "B"), sourcePath: "/main/code/problem/problemDetail.do", observedAt: 1
  });
  assert.equal(conflicting.kind, "invalid");
  assert.equal(new SweaAdapter(document, locationFor(QUERYLESS_SOLVING), undefined, undefined, conflicting.problemUrl, false).detectProblem(), null);
});

test("a no-row lookup validates its detail referrer but rejects referrer conflicts and lookup errors", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>7206. 숫자 게임</h3></div><input id="contestProbId" value="A">');
  const matching = resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), NORMAL_DETAIL, null);
  assert.deepEqual(matching, { kind: "verified", problemUrl: NORMAL_DETAIL });
  const conflict = resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), NORMAL_DETAIL.replace("A", "B"), null);
  assert.deepEqual(conflict, { kind: "invalid", problemUrl: null });
  assert.deepEqual(resolveSweaProblem(document, locationFor(QUERYLESS_SOLVING), "", SWEA_CONTEXT_LOOKUP_ERROR), { kind: "invalid", problemUrl: null });
});

test("query-less solving page rejects another problem, stale referrer, and ambiguous hidden identity", () => {
  const context = createSweaProblemContext(problemDocument("A").document, locationFor(NORMAL_DETAIL), 1_000);
  assert.ok(context);

  assert.equal(
    resolveSweaProblemUrl(problemDocument("B").document, locationFor(QUERYLESS_SOLVING), NORMAL_DETAIL, context),
    null
  );
  assert.equal(
    resolveSweaProblemUrl(problemDocument("A").document, locationFor(QUERYLESS_SOLVING), USER_DETAIL, context),
    null
  );
  assert.equal(
    resolveSweaProblemUrl(
      problemDocument("A", '<input name="contestProbId" value="B">').document,
      locationFor(QUERYLESS_SOLVING),
      NORMAL_DETAIL,
      context
    ),
    null
  );
});

test("self-identifying solving URL remains available without stored source context", () => {
  const url = `${QUERYLESS_SOLVING}?contestProbId=A`;
  assert.equal(resolveSweaProblemUrl(problemDocument("A").document, locationFor(url), "", null), NORMAL_DETAIL);
  assert.equal(resolveSweaProblemUrl(problemDocument("B").document, locationFor(url), "", null), null);
});

test("IndexedDB retains independent problem contexts across store reconstruction", async () => {
  const databaseName = `codearchive-context-${Date.now()}-${Math.random()}`;
  const store = new IndexedDbCaptureStore({ databaseName, indexedDb: indexedDB });
  const normal = createSweaProblemContext(problemDocument("A").document, locationFor(NORMAL_DETAIL), 1_000);
  const user = createSweaProblemContext(problemDocument("U1").document, locationFor(USER_DETAIL), 2_000);
  assert.ok(normal);
  assert.ok(user);
  await store.putSweaProblemContext(normal);
  await store.putSweaProblemContext(user);

  const reconstructed = new IndexedDbCaptureStore({ databaseName, indexedDb: indexedDB });
  assert.deepEqual(await reconstructed.getSweaProblemContext(NORMAL_DETAIL), normal);
  assert.deepEqual(await reconstructed.getSweaProblemContext(USER_DETAIL), user);
});

test("IndexedDB version upgrade adds context storage to an existing local archive", async () => {
  const databaseName = `codearchive-context-upgrade-${Date.now()}-${Math.random()}`;
  const legacyRequest = indexedDB.open(databaseName, 1);
  const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    legacyRequest.onupgradeneeded = () => {
      const database = legacyRequest.result;
      const captures = database.createObjectStore("captures", { keyPath: "captureId" });
      captures.createIndex("bySyncState", "syncState", { unique: false });
      database.createObjectStore("settings", { keyPath: "id" });
    };
    legacyRequest.onsuccess = () => resolve(legacyRequest.result);
    legacyRequest.onerror = () => reject(legacyRequest.error);
  });
  legacyDatabase.close();

  const upgraded = new IndexedDbCaptureStore({ databaseName, indexedDb: indexedDB });
  const context = createSweaProblemContext(problemDocument("A").document, locationFor(NORMAL_DETAIL), 1_000);
  assert.ok(context);
  await upgraded.putSweaProblemContext(context);
  assert.deepEqual(await upgraded.getSweaProblemContext(NORMAL_DETAIL), context);
});
