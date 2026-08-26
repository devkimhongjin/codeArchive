package com.codearchive.api.ai;

import java.time.Instant;
import java.util.UUID;

public record AiArtifactResponse(
        UUID id,
        UUID solutionId,
        AiArtifactType type,
        String content,
        String provider,
        String model,
        Instant createdAt
) {

    public static AiArtifactResponse from(AiArtifact artifact) {
        return new AiArtifactResponse(
                artifact.getId(),
                artifact.getSolutionId(),
                artifact.getType(),
                artifact.getContent(),
                artifact.getProvider(),
                artifact.getModel(),
                artifact.getCreatedAt()
        );
    }
}
