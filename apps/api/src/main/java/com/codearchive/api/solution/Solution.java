package com.codearchive.api.solution;

import com.codearchive.api.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "solutions", uniqueConstraints = @UniqueConstraint(
        name = "uk_solution_user_capture", columnNames = {"user_id", "capture_id"}))
public class Solution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @Column(name = "capture_id", nullable = false, length = 36)
    private String captureId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Platform platform;

    @Column(name = "problem_number", nullable = false, length = 100)
    private String problemNumber;

    @Column(nullable = false, length = 500)
    private String title;

    @Column(name = "problem_url", nullable = false, length = 2048)
    private String problemUrl;

    @Column(nullable = false, length = 100)
    private String language;

    @Column(name = "language_key", nullable = false, length = 100)
    private String languageKey;

    @Column(name = "source_code", nullable = false, columnDefinition = "TEXT")
    private String sourceCode;

    @Column(nullable = false, length = 20)
    private String result;

    @Column(name = "observed_at", nullable = false)
    private Instant observedAt;

    @Column(name = "solved_at", nullable = false)
    private Instant solvedAt;

    @Column(name = "execution_time", precision = 19, scale = 6)
    private BigDecimal executionTime;

    @Column(name = "memory_usage", precision = 19, scale = 6)
    private BigDecimal memoryUsage;

    @Column(name = "memory_value", precision = 19, scale = 6)
    private BigDecimal memoryValue;

    @Column(name = "memory_unit", length = 10)
    private String memoryUnit;

    /** Null is the default and means private, including every pre-community row. */
    @Column(name = "published_at")
    private Instant publishedAt;

    protected Solution() {
    }

    /** Keeps internal callers source-compatible while deriving the trusted key server-side. */
    public Solution(AppUser user, String captureId, Platform platform, String problemNumber, String title,
                    String problemUrl, String language, String sourceCode, String result,
                    Instant observedAt, Instant solvedAt, BigDecimal executionTime, BigDecimal memoryUsage) {
        this(user, captureId, platform, problemNumber, title, problemUrl, language,
                LanguageNormalizer.canonicalKey(language), sourceCode, result, observedAt, solvedAt,
                executionTime, memoryUsage);
    }

    public Solution(AppUser user, String captureId, Platform platform, String problemNumber, String title,
                    String problemUrl, String language, String languageKey, String sourceCode, String result,
                    Instant observedAt, Instant solvedAt, BigDecimal executionTime, BigDecimal memoryUsage) {
        this.user = user;
        this.captureId = captureId;
        update(platform, problemNumber, title, problemUrl, language, languageKey, sourceCode, result,
                observedAt, solvedAt, executionTime, memoryUsage);
    }

    public void update(Platform platform, String problemNumber, String title, String problemUrl,
                       String language, String languageKey, String sourceCode, String result, Instant observedAt,
                       Instant solvedAt, BigDecimal executionTime, BigDecimal memoryUsage) {
        this.platform = platform;
        this.problemNumber = problemNumber;
        this.title = title;
        this.problemUrl = problemUrl;
        this.language = language;
        this.languageKey = languageKey;
        this.sourceCode = sourceCode;
        this.result = result;
        this.observedAt = observedAt;
        this.solvedAt = solvedAt;
        this.executionTime = executionTime;
        this.memoryUsage = memoryUsage;
    }

    public Long getId() {
        return id;
    }

    public AppUser getUser() {
        return user;
    }

    public String getCaptureId() {
        return captureId;
    }

    public Platform getPlatform() {
        return platform;
    }

    public String getProblemNumber() {
        return problemNumber;
    }

    public String getTitle() {
        return title;
    }

    public String getProblemUrl() {
        return problemUrl;
    }

    public String getLanguage() {
        return language;
    }

    public String getLanguageKey() { return languageKey; }

    public String getSourceCode() {
        return sourceCode;
    }

    public String getResult() {
        return result;
    }

    public Instant getObservedAt() {
        return observedAt;
    }

    public Instant getSolvedAt() {
        return solvedAt;
    }

    public BigDecimal getExecutionTime() {
        return executionTime;
    }

    public BigDecimal getMemoryUsage() {
        return memoryUsage;
    }

    public BigDecimal getMemoryValue() { return memoryValue; }
    public String getMemoryUnit() { return memoryUnit; }
    public void setMemoryMeasurement(BigDecimal value, String unit) { this.memoryValue = value; this.memoryUnit = unit == null || unit.isBlank() ? "UNKNOWN" : unit; }
    public Instant getPublishedAt() { return publishedAt; }
    public boolean isPublished() { return publishedAt != null; }
    public void setPublished(boolean published, Instant now) {
        if (published && publishedAt == null) publishedAt = now;
        if (!published) publishedAt = null;
    }
}
