package com.codearchive.api.ai;

import java.sql.Date;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AiDailyUsageRepository {

    private final JdbcTemplate jdbcTemplate;

    public AiDailyUsageRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean tryConsume(
            UUID userId,
            LocalDate usageDate,
            int limit
    ) {
        List<Integer> counts = jdbcTemplate.query(
                """
                INSERT INTO ai_daily_usage (
                    user_id,
                    usage_date,
                    request_count
                )
                VALUES (?, ?, 1)
                ON CONFLICT (user_id, usage_date)
                DO UPDATE
                SET request_count = ai_daily_usage.request_count + 1
                WHERE ai_daily_usage.request_count < ?
                RETURNING request_count
                """,
                (resultSet, rowNum) -> resultSet.getInt(1),
                userId,
                Date.valueOf(usageDate),
                limit
        );

        return !counts.isEmpty();
    }
}
