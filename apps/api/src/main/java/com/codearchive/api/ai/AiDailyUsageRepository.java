package com.codearchive.api.ai;

import java.time.LocalDate;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiDailyUsageRepository extends JpaRepository<AiDailyUsage, Long> {
    Optional<AiDailyUsage> findByUserIdAndUsageDate(Long userId, LocalDate usageDate);
}
