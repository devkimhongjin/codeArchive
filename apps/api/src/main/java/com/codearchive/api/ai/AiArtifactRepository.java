package com.codearchive.api.ai;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AiArtifactRepository
        extends JpaRepository<AiArtifact, UUID> {

    @Query("""
            select artifact
            from AiArtifact artifact
            join Solution solution on solution.id = artifact.solutionId
            where artifact.solutionId = :solutionId
              and solution.userId = :userId
            order by artifact.createdAt desc
            """)
    List<AiArtifact> findOwnedBySolutionId(
            @Param("solutionId") UUID solutionId,
            @Param("userId") UUID userId
    );

    @Query("""
            select artifact
            from AiArtifact artifact
            join Solution solution on solution.id = artifact.solutionId
            where artifact.id = :artifactId
              and solution.userId = :userId
            """)
    Optional<AiArtifact> findOwnedById(
            @Param("artifactId") UUID artifactId,
            @Param("userId") UUID userId
    );
}
