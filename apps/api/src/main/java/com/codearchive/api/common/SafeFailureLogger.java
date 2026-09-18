package com.codearchive.api.common;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.MDC;

/** Logs only bounded identifiers. Never pass an exception or request payload to this boundary. */
public final class SafeFailureLogger {
    private SafeFailureLogger() {
    }

    public static void databaseConstraint(Logger logger, String captureId) {
        logger.error("event=database_write_failed errorCode=DATABASE_CONSTRAINT requestId={} captureId={}",
                requestId(), canonicalCaptureId(captureId));
    }

    public static void unexpectedProcessingFailure(Logger logger, String captureId) {
        logger.error("event=capture_processing_failed errorCode=CAPTURE_PROCESSING requestId={} captureId={}",
                requestId(), canonicalCaptureId(captureId));
    }

    public static void unexpectedRequestFailure(Logger logger) {
        logger.error("event=request_failed errorCode=UNEXPECTED_REQUEST requestId={}", requestId());
    }

    private static String requestId() {
        String value = MDC.get(RequestCorrelationFilter.MDC_KEY);
        return value == null || value.isBlank() ? "unavailable" : value;
    }

    private static String canonicalCaptureId(String value) {
        try {
            UUID id = UUID.fromString(value);
            return id.toString().equalsIgnoreCase(value) ? id.toString() : "unavailable";
        } catch (RuntimeException ignored) {
            return "unavailable";
        }
    }
}
