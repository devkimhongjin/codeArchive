package com.codearchive.api.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** One stored model answer, reused for every later request with the same cache key. */
@Entity
@Table(name = "ai_reviews")
public class AiReview {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "user_id", nullable = false) private Long userId;
    @Column(name = "solution_id", nullable = false) private Long solutionId;
    @Column(name = "cache_key", nullable = false, length = 64) private String cacheKey;
    @Column(nullable = false, length = 40) private String provider;
    @Column(nullable = false, length = 100) private String model;
    @Column(name = "prompt_version", nullable = false, length = 40) private String promptVersion;
    @Column(nullable = false, length = 2000) private String summary;
    /** JSON array of suggestion strings. */
    @Column(nullable = false, columnDefinition = "TEXT") private String suggestions;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected AiReview() {}

    AiReview(long userId, long solutionId, String cacheKey, String provider, String model, String promptVersion,
             String summary, String suggestions, Instant createdAt) {
        this.userId = userId; this.solutionId = solutionId; this.cacheKey = cacheKey;
        this.provider = provider; this.model = model; this.promptVersion = promptVersion;
        this.summary = summary; this.suggestions = suggestions; this.createdAt = createdAt;
    }

    public String getProvider() { return provider; }
    public String getModel() { return model; }
    public String getPromptVersion() { return promptVersion; }
    public String getSummary() { return summary; }
    public String getSuggestions() { return suggestions; }
    public Instant getCreatedAt() { return createdAt; }
}
