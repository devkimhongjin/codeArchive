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

    private static final String INSERT_COLUMNS = """
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
            """;

    private static final String INSERT_VALUES = """
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
            """;

    private static final String UPSERT_SQL = """
            INSERT INTO solutions (
            """ + INSERT_COLUMNS + """
            ) VALUES (
            """ + INSERT_VALUES + """
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

    private static final String INSERT_IF_ABSENT_SQL = """
            INSERT INTO solutions (
            """ + INSERT_COLUMNS + """
            ) VALUES (
            """ + INSERT_VALUES + """
            )
            ON CONFLICT (user_id, client_record_id)
            DO NOTHING
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
        return Objects.requireNonNull(
                jdbcTemplate.queryForObject(
                        UPSERT_SQL,
                        parameters(userId, clientRecordId, values, now),
                        UUID.class
                )
        );
    }

    public int insertIfAbsent(
            UUID userId,
            String clientRecordId,
            Values values,
            Instant now
    ) {
        int inserted = jdbcTemplate.update(
                INSERT_IF_ABSENT_SQL,
                parameters(userId, clientRecordId, values, now)
        );
        // A duplicate import can establish provenance for an unchanged legacy capture.
        // Never overwrite the archive, and never qualify a different/edited payload.
        jdbcTemplate.update("""
                UPDATE solutions SET accepted_capture = TRUE
                WHERE user_id = :userId AND client_record_id = :clientRecordId
                  AND platform = :platform AND problem_number = :problemNumber
                  AND language = :language AND code = :code
                  AND result = 'ACCEPTED' AND :result = 'ACCEPTED'
                  AND observed_at IS NOT NULL AND observed_at = :observedAt
                """, parameters(userId, clientRecordId, values, now));
        return inserted;
    }

    private MapSqlParameterSource parameters(
            UUID userId,
            String clientRecordId,
            Values values,
            Instant now
    ) {
        return new MapSqlParameterSource()
                .addValue("id", UUID.randomUUID())
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
