package com.codearchive.api.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.sql.Timestamp;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import java.sql.ResultSet;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class RelayCaptureIngestServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-04T00:00:00Z");
    @Mock NamedParameterJdbcTemplate db;
    @Mock RelayGrantService grants;
    private RelayCaptureIngestService service;
    private RelayGrantPrincipal principal;

    @BeforeEach
    void setUp() {
        service = new RelayCaptureIngestService(db, grants, Clock.fixed(NOW, ZoneOffset.UTC));
        principal = new RelayGrantPrincipal(UUID.randomUUID(), UUID.randomUUID(), "device-1234567890", 8);
        lenient().when(db.update(anyString(), any(MapSqlParameterSource.class))).thenReturn(1);
    }

    @Test
    void acceptedCaptureUsesGrantOwnerAndGenerationAndIsAppendOnly() {
        RelayCaptureIngestService.Response response = service.ingest(principal,
                new RelayCaptureIngestService.Request(List.of(item("client-1"))));

        assertThat(response.results()).singleElement().satisfies(result -> {
            assertThat(result.outcome()).isEqualTo("IMPORTED");
            assertThat(result.ackEligible()).isTrue();
        });
        ArgumentCaptor<MapSqlParameterSource> args = ArgumentCaptor.forClass(MapSqlParameterSource.class);
        verify(db).update(contains("INSERT INTO solutions"), args.capture());
        assertThat(args.getValue().getValues())
                .containsEntry("user", principal.userId())
                .containsEntry("generation", principal.generation())
                .containsEntry("result", "ACCEPTED");
        verify(db, never()).update(contains("UPDATE solutions"), any(MapSqlParameterSource.class));
        verify(grants).requireCurrentGeneration(principal);
    }

    @Test
    void identicalClientRecordRetryIsExistingAndDifferentBodyIsConflict() throws Exception {
        when(db.update(anyString(), any(MapSqlParameterSource.class))).thenReturn(0);
        ResultSet row = mock(ResultSet.class);
        when(row.getString("platform")).thenReturn("SWEA");
        when(row.getString("problem_number")).thenReturn("1206");
        when(row.getString("title")).thenReturn("title");
        when(row.getString("language")).thenReturn("Java");
        when(row.getString("code")).thenReturn("class Main {}");
        when(row.getTimestamp("solved_at")).thenReturn(Timestamp.from(NOW));
        when(row.getTimestamp("observed_at")).thenReturn(Timestamp.from(NOW));
        when(row.getString("execution_time")).thenReturn("78 ms");
        when(row.getString("memory_usage")).thenReturn("25,472 kb");
        when(row.getString("ai_usage")).thenReturn("unknown");
        when(row.getBoolean("accepted_capture")).thenReturn(true);
        when(db.query(contains("SELECT platform"), any(MapSqlParameterSource.class),
                any(org.springframework.jdbc.core.RowMapper.class))).thenAnswer(invocation -> {
                    @SuppressWarnings("unchecked") org.springframework.jdbc.core.RowMapper<Object> mapper =
                            invocation.getArgument(2);
                    return List.of(mapper.mapRow(row, 0));
                });

        RelayCaptureIngestService.Response existing = service.ingest(principal,
                new RelayCaptureIngestService.Request(List.of(item("client-1"))));
        RelayCaptureIngestService.Item changed = new RelayCaptureIngestService.Item("client-1", "SWEA", "1206",
                "title", "Java", "different code", "ACCEPTED", NOW, NOW, NOW, "78 ms", "25,472 kb", "unknown");
        RelayCaptureIngestService.Response conflict = service.ingest(principal,
                new RelayCaptureIngestService.Request(List.of(changed)));

        assertThat(existing.results()).singleElement().satisfies(result -> {
            assertThat(result.outcome()).isEqualTo("EXISTING");
            assertThat(result.ackEligible()).isTrue();
        });
        assertThat(conflict.results()).singleElement().satisfies(result -> {
            assertThat(result.outcome()).isEqualTo("CONFLICT");
            assertThat(result.ackEligible()).isFalse();
        });
    }

    @Test
    void batchAndPlatformBoundsFailClosedBeforePersistence() {
        List<RelayCaptureIngestService.Item> tooMany = java.util.stream.IntStream.range(0, 26)
                .mapToObj(index -> item("client-" + index)).toList();
        assertThatThrownBy(() -> service.ingest(principal, new RelayCaptureIngestService.Request(tooMany)))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        error -> assertThat(error.getErrorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));
        assertThatThrownBy(() -> service.ingest(principal, new RelayCaptureIngestService.Request(List.of(
                new RelayCaptureIngestService.Item("client-1", "OTHER", "1", "title", "Java", "code",
                        "ACCEPTED", NOW, NOW, NOW, null, null, "unknown")))))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        error -> assertThat(error.getErrorCode()).isEqualTo(ErrorCode.PLATFORM_NOT_SUPPORTED));
        verify(db, never()).update(anyString(), any(MapSqlParameterSource.class));
    }

    @Test
    void missingSolvedAtFailsClosedBeforePersistence() {
        RelayCaptureIngestService.Item invalid = new RelayCaptureIngestService.Item(
                "client-1", "SWEA", "1206", "title", "Java", "class Main {}",
                "ACCEPTED", null, NOW, NOW, "78 ms", "25,472 kb", "unknown");

        assertThatThrownBy(() -> service.ingest(principal,
                new RelayCaptureIngestService.Request(List.of(invalid))))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        error -> assertThat(error.getErrorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));
        verify(db, never()).update(anyString(), any(MapSqlParameterSource.class));
    }

    @Test
    void bodyCannotAddAnAccountOwnerField() throws Exception {
        String body = "{\"records\":[{" +
                "\"clientRecordId\":\"client-1\",\"platform\":\"SWEA\",\"problemNumber\":\"1\"," +
                "\"title\":\"title\",\"language\":\"Java\",\"code\":\"code\",\"result\":\"ACCEPTED\"," +
                "\"solvedAt\":\"2026-09-04T00:00:00Z\",\"observedAt\":\"2026-09-04T00:00:00Z\"," +
                "\"capturedAt\":\"2026-09-04T00:00:00Z\",\"userId\":\"spoof\"}]}";

        assertThatThrownBy(() -> new ObjectMapper().readValue(body, RelayCaptureIngestService.Request.class))
                .isInstanceOf(com.fasterxml.jackson.databind.JsonMappingException.class);
    }

    private RelayCaptureIngestService.Item item(String id) {
        return new RelayCaptureIngestService.Item(id, "SWEA", "1206", "title", "Java", "class Main {}",
                "ACCEPTED", NOW, NOW, NOW, "78 ms", "25,472 kb", "unknown");
    }
}
