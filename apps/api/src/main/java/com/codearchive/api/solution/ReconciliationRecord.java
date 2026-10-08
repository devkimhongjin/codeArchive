package com.codearchive.api.solution;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;

/** Bounded metadata response, never raw original code. */
public record ReconciliationRecord(String captureId, Platform platform, String historicalSubmissionId,
        String problemNumber, String language, Instant solvedAt, BigDecimal executionTime,
        BigDecimal memoryValue, ProblemDifficulty difficulty, String sourceDigest, long recordId) {
    static ReconciliationRecord from(Solution solution) {
        try {
            String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(solution.getSourceCode().getBytes(StandardCharsets.UTF_8)));
            return new ReconciliationRecord(solution.getCaptureId(), solution.getPlatform(), solution.getHistoricalSubmissionId(), solution.getProblemNumber(), solution.getLanguage(), solution.getSolvedAt(), solution.getExecutionTime(), solution.getMemoryValue(), solution.getDifficulty(), digest, solution.getId());
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException("SHA-256 unavailable"); }
    }
}
