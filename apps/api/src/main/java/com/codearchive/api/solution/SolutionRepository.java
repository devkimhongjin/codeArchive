package com.codearchive.api.solution;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SolutionRepository extends JpaRepository<Solution, Long> {
    Optional<Solution> findByUserIdAndCaptureId(Long userId, String captureId);

    List<Solution> findByUserIdOrderBySolvedAtDesc(Long userId);

    Optional<Solution> findByIdAndUserId(Long id, Long userId);

    boolean existsByUserIdAndPlatformAndProblemNumberAndPublishedAtIsNotNull(
            Long userId, Platform platform, String problemNumber);

    @Query("""
            select s from Solution s
            where s.platform = :platform and s.problemNumber = :problemNumber
              and s.publishedAt is not null and s.user.id <> :viewerId
              and exists (select own.id from Solution own
                          where own.user.id = :viewerId and own.platform = :platform
                            and own.problemNumber = :problemNumber and own.publishedAt is not null)
            """)
    Page<Solution> findSharedForProblem(@Param("viewerId") Long viewerId,
            @Param("platform") Platform platform, @Param("problemNumber") String problemNumber,
            Pageable pageable);

    @Query("""
            select s from Solution s
            where s.platform = :platform and s.problemNumber = :problemNumber
              and s.publishedAt is not null and s.user.id <> :viewerId
              and s.languageKey = :languageKey
              and exists (select own.id from Solution own
                          where own.user.id = :viewerId and own.platform = :platform
                            and own.problemNumber = :problemNumber and own.publishedAt is not null)
            """)
    Page<Solution> findSharedForProblemByLanguage(@Param("viewerId") Long viewerId,
            @Param("platform") Platform platform, @Param("problemNumber") String problemNumber,
            @Param("languageKey") String languageKey, Pageable pageable);

    @Query("""
            select s from Solution s
            where s.id = :id and s.publishedAt is not null and s.user.id <> :viewerId
              and exists (select own.id from Solution own
                          where own.user.id = :viewerId and own.platform = s.platform
                            and own.problemNumber = s.problemNumber and own.publishedAt is not null)
            """)
    Optional<Solution> findSharedDetail(@Param("viewerId") Long viewerId, @Param("id") Long id);
}
