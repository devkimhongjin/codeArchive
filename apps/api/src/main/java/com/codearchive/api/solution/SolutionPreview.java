package com.codearchive.api.solution;

import java.time.Instant;
import java.math.BigDecimal;

/** Source-free preview of a server-registered solution. */
public record SolutionPreview(String captureId, Platform platform, String problemNumber, String title,
        String language, Instant observedAt, Instant solvedAt, BigDecimal executionTime,
        BigDecimal memoryUsage, BigDecimal memoryValue, String memoryUnit) { }
