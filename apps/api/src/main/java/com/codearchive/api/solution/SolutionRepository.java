package com.codearchive.api.solution;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SolutionRepository
        extends JpaRepository<Solution, UUID> {

    Optional<Solution> findByIdAndUserId(
            UUID id,
            UUID userId
    );

    Optional<Solution> findByUserIdAndClientRecordId(
            UUID userId,
            String clientRecordId
    );

    List<Solution> findByUserIdOrderByObservedAtDescCreatedAtDesc(
            UUID userId,
            Pageable pageable
    );

    long countByUserIdAndClientRecordId(
            UUID userId,
            String clientRecordId
    );
}
