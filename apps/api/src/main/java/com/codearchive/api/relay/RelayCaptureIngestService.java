package com.codearchive.api.relay;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class RelayCaptureIngestService {

    public static final int MAX_BATCH_SIZE = 25;
    public static final int MAX_TOTAL_CODE_CHARS = 1_000_000;
    public static final int MAX_REQUESTS_PER_MINUTE = 60;
    private final NamedParameterJdbcTemplate db;
    private final RelayGrantService grants;
    private final Clock clock;
    private final ConcurrentHashMap<UUID, RateWindow> rateWindows = new ConcurrentHashMap<>();

    @Autowired
    public RelayCaptureIngestService(
            NamedParameterJdbcTemplate db,
            RelayGrantService grants
    ) {
        this(db, grants, Clock.systemUTC());
    }

    RelayCaptureIngestService(
            NamedParameterJdbcTemplate db,
            RelayGrantService grants,
            Clock clock
    ) {
        this.db = db;
        this.grants = grants;
        this.clock = clock;
    }

    @Transactional
    public Response ingest(RelayGrantPrincipal principal, Request request) {
        grants.requireCurrentGeneration(principal);
        enforceRateLimit(principal.grantId());
        List<Item> records = boundedRecords(request);
        Instant now = clock.instant();
        int totalCodeChars = 0;
        for (Item item : records) totalCodeChars += validate(item, now);
        if (totalCodeChars > MAX_TOTAL_CODE_CHARS) throw invalid();

        List<Result> results = new ArrayList<>(records.size());
        for (Item item : records) {
            String clientRecordId = item.clientRecordId().trim();
            var args = parameters(principal, item, clientRecordId, now);
            int inserted = db.update("""
                    INSERT INTO solutions (
                        id,user_id,client_record_id,platform,problem_number,title,language,code,result,
                        solved_at,observed_at,execution_time,memory_usage,ai_usage,
                        accepted_capture,community_public,published_at,capture_generation,captured_at,created_at,updated_at
                    ) VALUES (
                        :id,:user,:clientRecordId,:platform,:problemNumber,:title,:language,:code,:result,
                        :solvedAt,:observedAt,:executionTime,:memoryUsage,:aiUsage,
                        TRUE,FALSE,NULL,:generation,:capturedAt,:now,:now
                    ) ON CONFLICT (user_id,client_record_id) DO NOTHING
                    """, args);
            if (inserted == 1) {
                results.add(Result.imported(clientRecordId));
                continue;
            }
            if (sameRelayCapture(principal, item, clientRecordId)) {
                results.add(Result.existing(clientRecordId));
            } else {
                results.add(Result.conflict(clientRecordId));
            }
        }
        return new Response(List.copyOf(results));
    }

    private MapSqlParameterSource parameters(
            RelayGrantPrincipal principal,
            Item item,
            String clientRecordId,
            Instant now
    ) {
        return new MapSqlParameterSource()
                .addValue("id", UUID.randomUUID())
                .addValue("user", principal.userId())
                .addValue("clientRecordId", clientRecordId)
                .addValue("platform", normalized(item.platform()))
                .addValue("problemNumber", required(item.problemNumber(), 64))
                .addValue("title", required(item.title(), 255))
                .addValue("language", required(item.language(), 64))
                .addValue("code", item.code())
                .addValue("result", "ACCEPTED")
                .addValue("solvedAt", item.solvedAt())
                .addValue("observedAt", item.observedAt())
                .addValue("executionTime", optional(item.executionTime(), 128))
                .addValue("memoryUsage", optional(item.memoryUsage(), 128))
                .addValue("aiUsage", aiUsage(item.aiUsage()))
                .addValue("generation", principal.generation())
                .addValue("capturedAt", item.capturedAt())
                .addValue("now", now);
    }

    private boolean sameRelayCapture(RelayGrantPrincipal principal, Item item, String clientRecordId) {
        return db.query("""
                SELECT platform,problem_number,title,language,code,solved_at,observed_at,
                       execution_time,memory_usage,ai_usage,accepted_capture,capture_generation,captured_at
                FROM solutions WHERE user_id=:user AND client_record_id=:client
                """, new MapSqlParameterSource("user", principal.userId()).addValue("client", clientRecordId),
                (rs, index) -> new Existing(
                        rs.getString("platform"), rs.getString("problem_number"), rs.getString("title"),
                        rs.getString("language"), rs.getString("code"), instant(rs, "solved_at"),
                        instant(rs, "observed_at"), rs.getString("execution_time"), rs.getString("memory_usage"),
                        rs.getString("ai_usage"), rs.getBoolean("accepted_capture"),
                        nullableLong(rs, "capture_generation"),
                        instant(rs, "captured_at")))
                .stream().findFirst()
                .map(existing -> existing.acceptedCapture()
                        && Objects.equals(existing.platform(), normalized(item.platform()))
                        && Objects.equals(existing.problemNumber(), required(item.problemNumber(), 64))
                        && Objects.equals(existing.title(), required(item.title(), 255))
                        && Objects.equals(existing.language(), required(item.language(), 64))
                        && Objects.equals(existing.code(), item.code())
                        && Objects.equals(existing.solvedAt(), item.solvedAt())
                        && Objects.equals(existing.observedAt(), item.observedAt())
                        && Objects.equals(existing.executionTime(), optional(item.executionTime(), 128))
                        && Objects.equals(existing.memoryUsage(), optional(item.memoryUsage(), 128))
                        && Objects.equals(existing.aiUsage(), aiUsage(item.aiUsage()))
                        && Objects.equals(existing.generation(), principal.generation())
                        && Objects.equals(existing.capturedAt(), item.capturedAt()))
                .orElse(false);
    }

    private Long nullableLong(java.sql.ResultSet result, String column) throws java.sql.SQLException {
        long value = result.getLong(column);
        return result.wasNull() ? null : value;
    }

    private Instant instant(java.sql.ResultSet result, String column) throws java.sql.SQLException {
        java.sql.Timestamp value = result.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private List<Item> boundedRecords(Request request) {
        if (request == null || request.records() == null || request.records().isEmpty()
                || request.records().size() > MAX_BATCH_SIZE) throw invalid();
        return request.records();
    }

    private int validate(Item item, Instant now) {
        if (item == null || required(item.clientRecordId(), 128) == null
                || !"ACCEPTED".equals(required(item.result(), 32))) throw invalid();
        normalized(item.platform());
        required(item.problemNumber(), 64);
        required(item.title(), 255);
        required(item.language(), 64);
        if (item.code() == null || item.code().isBlank() || item.code().length() > 200_000) throw invalid();
        if (item.observedAt() == null || item.capturedAt() == null
                || item.capturedAt().isAfter(now.plusSeconds(300))) throw invalid();
        optional(item.executionTime(), 128);
        optional(item.memoryUsage(), 128);
        aiUsage(item.aiUsage());
        return item.code().length();
    }

    private String normalized(String value) {
        String result = value == null || value.isBlank() ? "SWEA" : value.trim();
        if (!result.equals("SWEA") && !result.equals("PROGRAMMERS")) throw new CodeArchiveException(ErrorCode.PLATFORM_NOT_SUPPORTED);
        return result;
    }

    private String required(String value, int max) {
        if (value == null || value.isBlank() || value.trim().length() > max) throw invalid();
        return value.trim();
    }

    private String optional(String value, int max) {
        if (value == null || value.isBlank()) return null;
        if (value.trim().length() > max) throw invalid();
        return value.trim();
    }

    private String aiUsage(String value) {
        String normalized = value == null || value.isBlank() ? "unknown" : value.trim();
        if (!normalized.equals("used") && !normalized.equals("not_used") && !normalized.equals("unknown")) throw invalid();
        return normalized;
    }

    private void enforceRateLimit(UUID grantId) {
        Instant now = clock.instant();
        rateWindows.compute(grantId, (ignored, old) -> {
            RateWindow window = old == null || !now.isBefore(old.windowStart().plusSeconds(60))
                    ? new RateWindow(now, 1) : new RateWindow(old.windowStart(), old.count() + 1);
            if (window.count() > MAX_REQUESTS_PER_MINUTE) throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
            return window;
        });
    }

    private CodeArchiveException invalid() { return new CodeArchiveException(ErrorCode.INVALID_REQUEST); }

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = false)
    public record Request(List<Item> records) {}

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = false)
    public record Item(
            String clientRecordId,
            String platform,
            String problemNumber,
            String title,
            String language,
            String code,
            String result,
            Instant solvedAt,
            Instant observedAt,
            Instant capturedAt,
            String executionTime,
            String memoryUsage,
            String aiUsage
    ) {}

    public record Response(List<Result> results) {}

    public record Result(String clientRecordId, String outcome, boolean ackEligible, String errorCode) {
        static Result imported(String id) { return new Result(id, "IMPORTED", true, null); }
        static Result existing(String id) { return new Result(id, "EXISTING", true, null); }
        static Result conflict(String id) { return new Result(id, "CONFLICT", false, "CLIENT_RECORD_CONFLICT"); }
    }

    private record Existing(String platform, String problemNumber, String title, String language, String code,
            Instant solvedAt, Instant observedAt, String executionTime, String memoryUsage, String aiUsage,
            boolean acceptedCapture, Long generation, Instant capturedAt) {}
    private record RateWindow(Instant windowStart, int count) {}
}
