package com.codearchive.api.solution;

import java.time.Instant;
import java.util.UUID;

public record SolutionResponse(
        UUID id,
        String clientRecordId,
        String platform,
        String problemNumber,
        String title,
        String language,
        String code,
        String result,
        Instant solvedAt,
        Instant observedAt,
        String executionTime,
        String memoryUsage,
        String aiUsage,
        Instant createdAt,
        Instant updatedAt
) {

    public static SolutionResponse from(Solution solution) {
        return new SolutionResponse(
                solution.getId(),
                solution.getClientRecordId(),
                solution.getPlatform(),
                solution.getProblemNumber(),
                solution.getTitle(),
                solution.getLanguage(),
                solution.getCode(),
                solution.getResult(),
                solution.getSolvedAt(),
                solution.getObservedAt(),
                solution.getExecutionTime(),
                solution.getMemoryUsage(),
                solution.getAiUsage(),
                solution.getCreatedAt(),
                solution.getUpdatedAt()
        );
    }
}
