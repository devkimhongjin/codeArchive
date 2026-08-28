package com.codearchive.api.solution;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
        name = "solutions",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_solutions_user_client_record",
                columnNames = {"user_id", "client_record_id"}
        )
)
public class Solution {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "client_record_id", nullable = false, length = 128)
    private String clientRecordId;

    @Column(nullable = false, length = 32)
    private String platform;

    @Column(name = "problem_number", nullable = false, length = 64)
    private String problemNumber;

    @Column(nullable = false, length = 255)
    private String title;

    @Column(nullable = false, length = 64)
    private String language;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String code;

    @Column(nullable = false, length = 32)
    private String result;

    @Column(name = "solved_at")
    private Instant solvedAt;

    @Column(name = "observed_at")
    private Instant observedAt;

    @Column(name = "execution_time", length = 128)
    private String executionTime;

    @Column(name = "memory_usage", length = 128)
    private String memoryUsage;

    @Column(name = "ai_usage", nullable = false, length = 16)
    private String aiUsage;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Solution() {
    }

    public UUID getId() {
        return id;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getClientRecordId() {
        return clientRecordId;
    }

    public String getPlatform() {
        return platform;
    }

    public String getProblemNumber() {
        return problemNumber;
    }

    public String getTitle() {
        return title;
    }

    public String getLanguage() {
        return language;
    }

    public String getCode() {
        return code;
    }

    public String getResult() {
        return result;
    }

    public Instant getSolvedAt() {
        return solvedAt;
    }

    public Instant getObservedAt() {
        return observedAt;
    }

    public String getExecutionTime() {
        return executionTime;
    }

    public String getMemoryUsage() {
        return memoryUsage;
    }

    public String getAiUsage() {
        return aiUsage;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
