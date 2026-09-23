package com.codearchive.api.solution;

import java.math.BigDecimal;
import java.time.Instant;

public class SolutionResponse {
    private final Long id;
    private final String captureId;
    private final Platform platform;
    private final String problemNumber;
    private final String title;
    private final String problemUrl;
    private final String language;
    private final String languageKey;
    private final String sourceCode;
    private final String result;
    private final Instant observedAt;
    private final Instant solvedAt;
    private final BigDecimal executionTime;
    private final BigDecimal memoryUsage;
    private final BigDecimal memoryValue;
    private final String memoryUnit;
    private final String visibility;
    private final Instant publishedAt;

    private SolutionResponse(Solution solution) {
        this.id = solution.getId();
        this.captureId = solution.getCaptureId();
        this.platform = solution.getPlatform();
        this.problemNumber = solution.getProblemNumber();
        this.title = solution.getTitle();
        this.problemUrl = solution.getProblemUrl();
        this.language = solution.getLanguage();
        this.languageKey = solution.getLanguageKey();
        this.sourceCode = solution.getSourceCode();
        this.result = solution.getResult();
        this.observedAt = solution.getObservedAt();
        this.solvedAt = solution.getSolvedAt();
        this.executionTime = solution.getExecutionTime();
        this.memoryUsage = solution.getMemoryUsage();
        this.memoryValue = solution.getMemoryValue();
        this.memoryUnit = solution.getMemoryUnit();
        this.visibility = solution.isPublished() ? "published" : "private";
        this.publishedAt = solution.getPublishedAt();
    }

    public static SolutionResponse from(Solution solution) {
        return new SolutionResponse(solution);
    }

    public Long getId() { return id; }
    public String getCaptureId() { return captureId; }
    public Platform getPlatform() { return platform; }
    public String getProblemNumber() { return problemNumber; }
    public String getTitle() { return title; }
    public String getProblemUrl() { return problemUrl; }
    public String getLanguage() { return language; }
    public String getLanguageKey() { return languageKey; }
    public String getSourceCode() { return sourceCode; }
    public String getResult() { return result; }
    public Instant getObservedAt() { return observedAt; }
    public Instant getSolvedAt() { return solvedAt; }
    public BigDecimal getExecutionTime() { return executionTime; }
    public BigDecimal getMemoryUsage() { return memoryUsage; }
    public BigDecimal getMemoryValue() { return memoryValue; }
    public String getMemoryUnit() { return memoryUnit; }
    public String getVisibility() { return visibility; }
    public Instant getPublishedAt() { return publishedAt; }
}
