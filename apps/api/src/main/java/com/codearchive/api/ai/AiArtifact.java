package com.codearchive.api.ai;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "ai_artifacts")
public class AiArtifact {

    @Id
    private UUID id;

    @Column(name = "solution_id", nullable = false)
    private UUID solutionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AiArtifactType type;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false, length = 64)
    private String provider;

    @Column(nullable = false, length = 128)
    private String model;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected AiArtifact() {
    }

    private AiArtifact(
            UUID id,
            UUID solutionId,
            AiArtifactType type,
            String content,
            String provider,
            String model,
            Instant createdAt
    ) {
        this.id = id;
        this.solutionId = solutionId;
        this.type = type;
        this.content = content;
        this.provider = provider;
        this.model = model;
        this.createdAt = createdAt;
    }

    public static AiArtifact create(
            UUID solutionId,
            AiArtifactType type,
            String content,
            String provider,
            String model,
            Instant createdAt
    ) {
        return new AiArtifact(
                UUID.randomUUID(),
                solutionId,
                type,
                content,
                provider,
                model,
                createdAt
        );
    }

    public UUID getId() {
        return id;
    }

    public UUID getSolutionId() {
        return solutionId;
    }

    public AiArtifactType getType() {
        return type;
    }

    public String getContent() {
        return content;
    }

    public String getProvider() {
        return provider;
    }

    public String getModel() {
        return model;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
