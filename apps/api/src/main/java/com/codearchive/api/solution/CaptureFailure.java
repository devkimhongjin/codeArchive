package com.codearchive.api.solution;

public class CaptureFailure {
    private final String captureId;
    private final String message;

    public CaptureFailure(String captureId, String message) {
        this.captureId = captureId;
        this.message = message;
    }

    public String getCaptureId() { return captureId; }
    public String getMessage() { return message; }
}
