import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { isHistoricalSubmissionId, programmersHistoricalSubmissionId } from "../src/historicalIdentity";
import { authenticatedProgrammersUserId, hasUniqueProgrammersHistoryIdentity, programmersLessonHistory, selectedProgrammersHistoryEditorUri } from "../src/historicalProgrammers";

const lessonUrl = { origin: "https://school.programmers.co.kr", pathname: "/learn/courses/30/lessons/389481" } as Location;

test("Programmers historical key is precise and rejects ambiguous or fabricated timestamp parts", () => {
  const id = programmersHistoricalSubmissionId("947840", "389481", "2026-09-21T16:43:28.310+09:00", "java");
  assert.equal(id, "pg:947840:389481:2026-09-21T16:43:28.310+09:00:java");
  assert.equal(isHistoricalSubmissionId("PROGRAMMERS", id), true);
  assert.equal(programmersHistoricalSubmissionId("947840", "389481", "2026-09-21T16:43:28+09:00", "java"), null);
  assert.equal(isHistoricalSubmissionId("SWEA", "AaDlMO4KzC3HBISr"), true);
  assert.equal(isHistoricalSubmissionId("SWEA", "<script>"), false);
});

test("Programmers requires the matching source-owned user and selected-row editor", () => {
  const { document } = parseHTML(`<div class="challenge-content lesson-algorithm-main-section" data-user-id="947840" data-challengeable-id="389481"></div>
    <div data-challengeable-submission-history-component data-user-id="947840" data-lesson-id="389481" class="submission-history-wrapper">
      <div class="SubmissionListstyle__ListRow" data-hackle-value='{"key":"open_challenge_lesson_submission_history_list_item_toggle_clicked","properties":{"lesson_id":389481,"created_at":"2026-09-21T16:43:28.310+09:00","language":"java","score":100,"is_perfect_score":true}}'>
        <div class="ListItemCodeWrapper"><div class="monaco-editor" role="code" data-uri="inmemory://model/1"></div></div>
      </div></div>`);
  assert.equal(authenticatedProgrammersUserId(document, lessonUrl), "947840");
  const rows = programmersLessonHistory(document, lessonUrl)!;
  assert.equal(rows.length, 1);
  assert.equal(hasUniqueProgrammersHistoryIdentity(rows, rows[0]!), true);
  document.querySelector(".challenge-content")!.setAttribute("data-challengeable-id", "999");
  assert.equal(authenticatedProgrammersUserId(document, lessonUrl), null);
  document.querySelector(".challenge-content")!.setAttribute("data-challengeable-id", "389481");
  assert.equal(selectedProgrammersHistoryEditorUri(rows[0]!.row), "inmemory://model/1");
  document.querySelector("[data-challengeable-submission-history-component]")!.setAttribute("data-user-id", "999");
  assert.equal(authenticatedProgrammersUserId(document, lessonUrl), null);
});
