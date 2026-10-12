package com.codearchive.api.solution;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Modifying;
import java.time.Instant;
import org.springframework.data.repository.query.Param;

public interface SolutionRepository extends JpaRepository<Solution, Long> {
    @Query("select new com.codearchive.api.solution.SolutionPreview(s.captureId, s.platform, s.problemNumber, s.title, s.language, s.observedAt, s.solvedAt, s.executionTime, s.memoryUsage, s.memoryValue, s.memoryUnit) from Solution s where s.user.id = :userId and not exists (select n.id from Solution n where n.user.id = :userId and n.platform = s.platform and n.problemNumber = s.problemNumber and (n.observedAt > s.observedAt or (n.observedAt = s.observedAt and n.id > s.id))) order by s.observedAt desc, s.id desc")
    List<SolutionPreview> findRecentProblemPreviews(@Param("userId") Long userId, Pageable pageable);
    List<Solution> findByUserIdAndPlatformAndIdGreaterThanOrderByIdAsc(Long userId, Platform platform, Long afterId, Pageable pageable);
    Optional<Solution> findByUserIdAndCaptureId(Long userId, String captureId);
    Optional<Solution> findByUserIdAndPlatformAndHistoricalSubmissionId(Long userId, Platform platform, String historicalSubmissionId);

    @Query("select s.historicalSubmissionId from Solution s where s.user.id = :userId and s.platform = :platform and s.historicalSubmissionId is not null")
    List<String> findHistoricalSubmissionIds(@Param("userId") Long userId, @Param("platform") Platform platform);

    List<Solution> findByUserIdOrderBySolvedAtDesc(Long userId);
    List<Solution> findByUserIdAndPlatformAndProblemNumberAndPublishedAtIsNotNull(Long userId, Platform platform, String problemNumber);

    Optional<Solution> findByIdAndUserId(Long id, Long userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update Solution s set s.publishedAt = :now where s.user.id = :ownerId and s.result = 'ACCEPTED' and s.publishedAt is null")
    int publishAcceptedForOwner(@Param("ownerId") long ownerId, @Param("now") Instant now);

    long countByUserIdAndResultAndPublishedAtIsNotNull(Long userId, String result);

    @Query("select distinct s.platform, s.problemNumber from Solution s where s.user.id = :ownerId and s.result = 'ACCEPTED' and s.publishedAt is not null")
    List<Object[]> findPublishedProblemsForOwner(@Param("ownerId") long ownerId);

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
            where s.id = :id and s.publishedAt is not null and s.result = 'ACCEPTED'
              and exists (select own.id from Solution own
                          where own.user.id = :viewerId and own.platform = s.platform
                            and own.problemNumber = s.problemNumber and own.publishedAt is not null and own.result = 'ACCEPTED')
            """)
    Optional<Solution> findSharedDetail(@Param("viewerId") Long viewerId, @Param("id") Long id);
}
