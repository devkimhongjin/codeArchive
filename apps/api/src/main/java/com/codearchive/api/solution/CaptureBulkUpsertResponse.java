package com.codearchive.api.solution;

import java.util.List;

public record CaptureBulkUpsertResponse(
        List<ItemResult> results
) {

    public enum Outcome {
        IMPORTED,
        EXISTING,
        FAILED
    }

    public record ItemResult(
            String clientRecordId,
            Outcome outcome,
            boolean ackEligible,
            String errorCode
    ) {

        public static ItemResult imported(String clientRecordId) {
            return new ItemResult(
                    clientRecordId,
                    Outcome.IMPORTED,
                    true,
                    null
            );
        }

        public static ItemResult existing(String clientRecordId) {
            return new ItemResult(
                    clientRecordId,
                    Outcome.EXISTING,
                    true,
                    null
            );
        }

        public static ItemResult failed(
                String clientRecordId,
                String errorCode
        ) {
            return new ItemResult(
                    clientRecordId,
                    Outcome.FAILED,
                    false,
                    errorCode
            );
        }
    }
}
