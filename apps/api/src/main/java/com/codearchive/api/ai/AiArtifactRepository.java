package com.codearchive.api.ai;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AiArtifactRepository
        extends JpaRepository<AiArtifact, UUID> {

    @Query(
            value = """
                    SELECT artifact.*
                    FROM ai_artifacts artifact
                    JOIN solutions solution
                      ON solution.id = artifact.solution_id
                    WHERE artifact.solution_id = :solutionId
                      AND solution.user_id = :userId
                    ORDER BY artifact.created_at DESC
                    """,
            nativeQuery = true
    )
    List<AiArtifact> findOwnedBySolutionId(
            @Param("solutionId") UUID solutionId,
            @Param("userId") UUID userId
    );

    @Query(
            value = """
                    SELECT artifact.*
                    FROM ai_artifacts artifact
                    JOIN solutions solution
                      ON solution.id = artifact.solution_id
                    WHERE artifact.id = :artifactId
                      AND solution.user_id = :userId
                    """,
            nativeQuery = true
    )
    Optional<AiArtifact> findOwnedById(
            @Param("artifactId") UUID artifactId,
            @Param("userId") UUID userId
    );
}
