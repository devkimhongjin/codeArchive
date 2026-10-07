package com.codearchive.api.solution;

import java.util.List;

public class BulkUpsertResponse {
    private final List<String> acceptedCaptureIds;
    private final List<CaptureFailure> failures;

    public BulkUpsertResponse(List<String> acceptedCaptureIds, List<CaptureFailure> failures) {
        this.acceptedCaptureIds = acceptedCaptureIds;
        this.failures = failures;
    }

    public List<String> getAcceptedCaptureIds() { return acceptedCaptureIds; }
    public List<CaptureFailure> getFailures() { return failures; }
}
