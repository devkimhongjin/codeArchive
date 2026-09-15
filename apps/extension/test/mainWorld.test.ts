import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  EDITOR_SYNC_ATTRIBUTE,
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
