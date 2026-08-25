package com.codearchive.api.solution;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SolutionUpsertRepository {

    private static final String UPSERT_SQL = """
            INSERT INTO solutions (
                id,
                user_id,
                client_record_id,
                platform,
                problem_number,
                title,
                language,
                code,
                result,
                solved_at,
                observed_at,
                execution_time,
                memory_usage,
                ai_usage,
                created_at,
                updated_at
            ) VALUES (
                :id,
                :userId,
                :clientRecordId,
                :platform,
                :problemNumber,
                :title,
                :language,
                :code,
                :result,
                :solvedAt,
                :observedAt,
                :executionTime,
                :memoryUsage,
                :aiUsage,
                :createdAt,
                :updatedAt
            )
            ON CONFLICT (user_id, client_record_id)
            DO UPDATE SET
                platform = EXCLUDED.platform,
                problem_number = EXCLUDED.problem_number,
                title = EXCLUDED.title,
                language = EXCLUDED.language,
                code = EXCLUDED.code,
                result = EXCLUDED.result,
                solved_at = EXCLUDED.solved_at,
                observed_at = EXCLUDED.observed_at,
                execution_time = EXCLUDED.execution_time,
                memory_usage = EXCLUDED.memory_usage,
                ai_usage = EXCLUDED.ai_usage,
                updated_at = EXCLUDED.updated_at
            RETURNING id
            """;

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public SolutionUpsertRepository(
            NamedParameterJdbcTemplate jdbcTemplate
    ) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public UUID upsert(
            UUID userId,
            String clientRecordId,
            Values values,
            Instant now
    ) {
        UUID candidateId = UUID.randomUUID();
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("id", candidateId)
                .addValue("userId", userId)
                .addValue("clientRecordId", clientRecordId)
                .addValue("platform", values.platform())
                .addValue("problemNumber", values.problemNumber())
                .addValue("title", values.title())
                .addValue("language", values.language())
                .addValue("code", values.code())
                .addValue("result", values.result())
                .addValue("solvedAt", toOffsetDateTime(values.solvedAt()))
                .addValue("observedAt", toOffsetDateTime(values.observedAt()))
                .addValue("executionTime", values.executionTime())
                .addValue("memoryUsage", values.memoryUsage())
                .addValue("aiUsage", values.aiUsage())
                .addValue("createdAt", toOffsetDateTime(now))
                .addValue("updatedAt", toOffsetDateTime(now));

        return Objects.requireNonNull(
                jdbcTemplate.queryForObject(
                        UPSERT_SQL,
                        parameters,
                        UUID.class
                )
        );
    }

    private OffsetDateTime toOffsetDateTime(Instant value) {
        return value == null
                ? null
                : value.atOffset(ZoneOffset.UTC);
    }

    public record Values(
            String platform,
            String problemNumber,
            String title,
            String language,
            String code,
            String result,
            Instant solvedAt,
            Instant observedAt,
            String executionTime,
            String memoryUsage,
            String aiUsage
    ) {
    }
}
