package com.codearchive.api.solution;

import java.time.Instant;

/** Deliberately excludes source code and authentication material. */
public record HistoricalCommitCandidate(String captureId, Platform platform, String historicalSubmissionId,
        String problemNumber, String title, String language, Instant solvedAt, String state) {
    public static HistoricalCommitCandidate from(Solution solution, String state) {
        return new HistoricalCommitCandidate(solution.getCaptureId(), solution.getPlatform(),
                solution.getHistoricalSubmissionId(), solution.getProblemNumber(), solution.getTitle(),
                solution.getLanguage(), solution.getSolvedAt(), state);
    }
}
