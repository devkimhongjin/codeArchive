package com.codearchive.api.ai;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AiReviewRepository extends JpaRepository<AiReview, Long> {
    Optional<AiReview> findByUserIdAndCacheKey(Long userId, String cacheKey);

    @Modifying
    @Query("delete from AiReview r where r.userId = :userId")
    int deleteByUser(@Param("userId") Long userId);
}
