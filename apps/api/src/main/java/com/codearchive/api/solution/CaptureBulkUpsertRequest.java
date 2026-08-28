package com.codearchive.api.solution;

import java.time.Instant;
import java.util.List;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CaptureBulkUpsertRequest(
        @NotNull
        @Size(min = 1, max = 25)
        List<CaptureItem> records,

        @Size(max = 128)
        String importBatchId
) {

    public record CaptureItem(
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
            String aiUsage
    ) {
    }
}
