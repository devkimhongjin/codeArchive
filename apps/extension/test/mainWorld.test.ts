import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import test from "node:test";
import { dirname } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import {
  EDITOR_SYNC_ATTRIBUTE,
  installJungolJudgeObserver,
  installMainWorldSync,
  syncEditorAtSubmitClick
} from "../src/mainWorld";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

test("MAIN-world SWEA sync calls cEditor.save before the isolated snapshot", () => {
  const { document } = parseHTML('<html><body><textarea id="textSource"></textarea></body></html>');
  let saves = 0;
  const location = locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1");
  const window = {
    cEditor: {
      save() {
        saves += 1;
        (document.querySelector("#textSource") as HTMLTextAreaElement).value = "latest source";
      }
    }
  } as unknown as Window;

  assert.equal(syncEditorAtSubmitClick(document, location, window), true);
  assert.equal(saves, 1);
  assert.equal((document.querySelector("#textSource") as HTMLTextAreaElement).value, "latest source");
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^synced:/);
});

test("bundled MAIN-world SWEA sync resolves lexical cEditor without window.cEditor", () => {
  const { document } = parseHTML('<html><body><textarea id="textSource"></textarea></body></html>');
  const mainWorldPath = fileURLToPath(new URL("../src/mainWorld.ts", import.meta.url));
  const harness = `import { syncEditorAtSubmitClick } from ${JSON.stringify(mainWorldPath)}; globalThis.__syncEditorAtSubmitClick = syncEditorAtSubmitClick;`;
  const bundled = buildSync({
    stdin: {
      contents: harness,
      loader: "ts",
      resolveDir: dirname(mainWorldPath),
      sourcefile: "mainWorld-test-harness.ts"
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false
  }).outputFiles[0]?.text;
  assert.ok(bundled);

  const context = vm.createContext({
    document,
    window: {}
  });
  vm.runInContext(`
    let saves = 0;
    let cEditor = {
      save() {
        saves += 1;
        document.querySelector("#textSource").value = "latest lexical source";
      }
    };
    ${bundled}
  `, context);

  assert.equal(vm.runInContext("Object.prototype.hasOwnProperty.call(globalThis, 'cEditor')", context), false);
  const sync = (context as typeof context & {
    __syncEditorAtSubmitClick: typeof syncEditorAtSubmitClick;
  }).__syncEditorAtSubmitClick;
  const location = locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1");
  assert.equal(sync(document, location, {} as Window), true);
  assert.equal(vm.runInContext("saves", context), 1);
  assert.equal((document.querySelector("#textSource") as HTMLTextAreaElement).value, "latest lexical source");
});

test("MAIN-world Programmers sync calls the CodeMirror save/getValue path", () => {
  const { document } = parseHTML('<html><body><textarea id="code" name="code"></textarea></body></html>');
  let saves = 0;
  const code = document.querySelector("#code") as HTMLTextAreaElement & { CodeMirror?: unknown };
  code.CodeMirror = {
    save() { saves += 1; },
    getValue() { return "latest programmers source"; }
  };
  const location = locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42842");

  assert.equal(syncEditorAtSubmitClick(document, location), true);
  assert.equal(saves, 1);
  assert.equal(code.value, "latest programmers source");
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^synced:/);
});

test("MAIN-world listener is exact-submit scoped and has no page-wide command channel", () => {
  const { document } = parseHTML('<html><body><textarea id="code" name="code"></textarea><button id="other">other</button><button id="submit-code">submit</button></body></html>');
  const code = document.querySelector("#code") as HTMLTextAreaElement & { CodeMirror?: unknown };
  code.CodeMirror = { save() {}, getValue() { return "synced"; } };
  const cleanup = installMainWorldSync(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42842"));
  const click = () => {
    const event = document.createEvent("Event");
    event.initEvent("click", true, true);
    return event;
  };
  document.querySelector("#other")!.dispatchEvent(click());
  assert.equal(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE), null);
  document.querySelector("#submit-code")!.dispatchEvent(click());
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^synced:/);
  cleanup();
});

test("MAIN-world sync fails closed when a platform editor is unavailable", () => {
  const { document } = parseHTML('<html><body><textarea id="textSource"></textarea></body></html>');
  const location = locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=AV1");
  assert.equal(syncEditorAtSubmitClick(document, location, {} as Window), false);
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^failed:/);
});

test("MAIN-world Jungol sync reads only the matching Monaco model at submit", () => {
  const { document } = parseHTML('<html><body><div class="monaco-editor" data-uri="file:///workspace/problem_4577_JAVA.java"></div><button id="language">language Java 8</button><button id="submit">upload 제출</button></body></html>');
  const model = { uri: { toString: () => "file:///workspace/problem_4577_JAVA.java" }, getValue: () => "class Main {}" };
  const window = { monaco: { editor: { getModels: () => [model] } } } as unknown as Window;
  const location = locationFor("https://jungol.co.kr/problem/4577");
  assert.equal(syncEditorAtSubmitClick(document, location, window), true);
  const source = document.querySelector("textarea[data-codearchive-jungol-source]") as HTMLTextAreaElement;
  assert.equal(source.value, "class Main {}");
  assert.equal(source.dataset.codearchiveJungolProblem, "4577");
  assert.equal(source.dataset.codearchiveJungolLanguage, "Java 8");
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^synced:/);
  const wrongWindow = { monaco: { editor: { getModels: () => [{ ...model, uri: { toString: () => "file:///workspace/problem_9999_JAVA.java" } }] } } } as unknown as Window;
  assert.equal(syncEditorAtSubmitClick(document, location, wrongWindow), false);
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^failed:/);
});

test("MAIN-world Jungol observer reads only the unchanged exact judge POST", async () => {
  const { document } = parseHTML('<html><body><button>language Java 8</button></body></html>');
  const calls: Array<{ input: string; body: string | undefined }> = [];
  const originalFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), body: typeof init?.body === "string" ? init.body : undefined });
    return new Response("ok");
  }) as typeof fetch;
  const fakeWindow = { fetch: originalFetch } as unknown as Window;
  const cleanup = installJungolJudgeObserver(document, locationFor("https://jungol.co.kr/problem/4577"), fakeWindow);
  const body = JSON.stringify({ problemId: 4577, language: "JAVA", altLanguage: "JAVA8", sourceText: "class Main {}" });
  await fakeWindow.fetch("https://saet.jungol.co.kr/judge", { method: "POST", headers: { "content-type": "application/json" }, body });
  const source = document.querySelector("textarea[data-codearchive-jungol-source]") as HTMLTextAreaElement;
  assert.equal(source.value, "class Main {}");
  assert.equal(source.dataset.codearchiveJungolLanguage, "Java 8");
  assert.match(source.dataset.codearchiveJungolRequestAt ?? "", /^\d+$/);
  assert.match(document.documentElement.getAttribute(EDITOR_SYNC_ATTRIBUTE) ?? "", /^synced:/);
  await fakeWindow.fetch("https://saet.jungol.co.kr/judge", { method: "POST", headers: { "content-type": "application/json" }, body: body.replace("4577", "9999") });
  await fakeWindow.fetch("https://saet.jungol.co.kr/other", { method: "POST", headers: { "content-type": "application/json" }, body: body.replace("class Main {}", "wrong") });
  assert.equal(source.value, "class Main {}", "another problem or endpoint must not replace the snapshot");
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.body, body, "the platform request must be forwarded unchanged");
  cleanup();
  assert.equal(fakeWindow.fetch, originalFetch);
});
