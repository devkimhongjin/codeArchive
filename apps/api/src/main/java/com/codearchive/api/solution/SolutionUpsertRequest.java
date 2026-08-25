package com.codearchive.api.solution;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record SolutionUpsertRequest(
        @Size(max = 32)
        String platform,

        @NotBlank
        @Size(max = 64)
        String problemNumber,

        @NotBlank
        @Size(max = 255)
        String title,

        @NotBlank
        @Size(max = 64)
        String language,

        @NotBlank
        @Size(max = 200_000)
        String code,

        @NotBlank
        @Size(max = 32)
        String result,

        Instant solvedAt,
        Instant observedAt,

        @Size(max = 128)
        String executionTime,

        @Size(max = 128)
        String memoryUsage,

        @Pattern(regexp = "used|not_used|unknown")
        String aiUsage
) {
}
