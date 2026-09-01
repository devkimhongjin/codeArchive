package com.codearchive.api.solution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSession;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserRepository;

import jakarta.persistence.EntityManagerFactory;

@SpringBootTest(properties = "DB_PASSWORD=test-only")
@AutoConfigureMockMvc
@Testcontainers
class SolutionPersistenceIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AuthSessionRepository authSessionRepository;

    @Autowired
    private SecureTokenCodec tokenCodec;

    @Autowired
    private SolutionRepository solutionRepository;

    @Autowired
    private SolutionService solutionService;

    @AfterEach
    void cleanDatabase() {
        solutionRepository.deleteAllInBatch();
        authSessionRepository.deleteAllInBatch();
        userRepository.deleteAllInBatch();
    }

    @Test
    void flywayV1AndV2ApplyAndHibernateValidateStarts()
            throws Exception {
        Integer applied = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history "
                        + "WHERE version IN ('1', '2') AND success = true",
                Integer.class
        );
        String tableName = jdbcTemplate.queryForObject(
                "SELECT to_regclass('public.solutions')::text",
                String.class
        );

        assertThat(POSTGRES.isRunning()).isTrue();
        assertThat(applied).isEqualTo(2);
        assertThat(tableName).isEqualTo("solutions");
        assertThat(entityManagerFactory.isOpen()).isTrue();
    }

    @Test
    void authenticatedApiKeepsUsersIsolatedAndAllowsSameClientId()
            throws Exception {
        TestUser userA = createAuthenticatedUser(1001L, "user-a");
        TestUser userB = createAuthenticatedUser(2002L, "user-b");

        mockMvc.perform(
                        put("/api/v1/solutions/by-client-id/shared-local-id")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(userA.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(basePayload(
                                        "A title",
                                        null,
                                        null,
                                        "unknown"
                                ))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.clientRecordId")
                        .value("shared-local-id"))
                .andExpect(jsonPath("$.data.executionTime").isEmpty())
                .andExpect(jsonPath("$.data.memoryUsage").isEmpty())
                .andExpect(jsonPath("$.data.aiUsage").value("unknown"));

        Solution solutionA = solutionRepository
                .findByUserIdAndClientRecordId(
                        userA.user().getId(),
                        "shared-local-id"
                )
                .orElseThrow();

        mockMvc.perform(
                        get("/api/v1/solutions/{id}", solutionA.getId())
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(userA.token())
                                )
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("A title"));

        mockMvc.perform(
                        get("/api/v1/solutions/{id}", solutionA.getId())
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(userB.token())
                                )
                )
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code")
                        .value("SOLUTION_NOT_FOUND"));

        mockMvc.perform(
                        put("/api/v1/solutions/by-client-id/shared-local-id")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(userB.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(basePayload(
                                        "B title",
                                        "81 ms",
                                        "32 MB",
                                        "not_used"
                                ))
                )
                .andExpect(status().isOk());

        Solution solutionB = solutionRepository
                .findByUserIdAndClientRecordId(
                        userB.user().getId(),
                        "shared-local-id"
                )
                .orElseThrow();

        assertThat(solutionB.getId()).isNotEqualTo(solutionA.getId());
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                userA.user().getId(),
                "shared-local-id"
        )).isEqualTo(1);
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                userB.user().getId(),
                "shared-local-id"
        )).isEqualTo(1);

        mockMvc.perform(
                        get("/api/v1/solutions")
                                .param("limit", "10")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(userA.token())
                                )
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].title").value("A title"));
    }

    @Test
    void programmersPlatformIsAcceptedAndPersisted() throws Exception {
        TestUser user = createAuthenticatedUser(3003L, "programmers-user");

        mockMvc.perform(
                        put("/api/v1/solutions/by-client-id/programmers-42842")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(basePayload(
                                        "카펫",
                                        null,
                                        null,
                                        "unknown"
                                ).replace(
                                        "\"SWEA\"",
                                        "\"PROGRAMMERS\""
                                ))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.platform")
                        .value("PROGRAMMERS"));

        Solution stored = solutionRepository
                .findByUserIdAndClientRecordId(
                        user.user().getId(),
                        "programmers-42842"
                )
                .orElseThrow();
        assertThat(stored.getPlatform()).isEqualTo("PROGRAMMERS");
    }

    @Test
    void retryUpdatesSameRowAndPreservesCreatedAtAndMetricsExactly()
            throws Exception {
        TestUser user = createAuthenticatedUser(3003L, "editor");

        mockMvc.perform(
                        put("/api/v1/solutions/by-client-id/editable-id")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(basePayload(
                                        "Original title",
                                        null,
                                        null,
                                        "unknown"
                                ))
                )
                .andExpect(status().isOk());

        Solution first = solutionRepository
                .findByUserIdAndClientRecordId(
                        user.user().getId(),
                        "editable-id"
                )
                .orElseThrow();
        UUID firstId = first.getId();
        Instant createdAt = first.getCreatedAt();

        mockMvc.perform(
                        put("/api/v1/solutions/by-client-id/editable-id")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(basePayload(
                                        "Edited title",
                                        "123 ms",
                                        "64 MB",
                                        "used"
                                ))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id")
                        .value(firstId.toString()))
                .andExpect(jsonPath("$.data.executionTime")
                        .value("123 ms"))
                .andExpect(jsonPath("$.data.memoryUsage")
                        .value("64 MB"))
                .andExpect(jsonPath("$.data.aiUsage").value("used"));

        Solution updated = solutionRepository
                .findByUserIdAndClientRecordId(
                        user.user().getId(),
                        "editable-id"
                )
                .orElseThrow();

        assertThat(updated.getId()).isEqualTo(firstId);
        assertThat(updated.getCreatedAt()).isEqualTo(createdAt);
        assertThat(updated.getTitle()).isEqualTo("Edited title");
        assertThat(updated.getExecutionTime()).isEqualTo("123 ms");
        assertThat(updated.getMemoryUsage()).isEqualTo("64 MB");
        assertThat(updated.getAiUsage()).isEqualTo("used");
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                user.user().getId(),
                "editable-id"
        )).isEqualTo(1);
    }

    @Test
    void concurrentFirstWritesUseAtomicPostgresUpsert()
            throws Exception {
        TestUser user = createAuthenticatedUser(4004L, "concurrent");
        CodeArchivePrincipal principal = new CodeArchivePrincipal(
                user.user().getId(),
                user.session().getId(),
                user.user().getGithubLogin()
        );
        SolutionUpsertRequest request = new SolutionUpsertRequest(
                "SWEA",
                "1234",
                "Concurrent title",
                "Java",
                "public class Main {}",
                "ACCEPTED",
                Instant.parse("2026-08-25T06:00:00Z"),
                Instant.parse("2026-08-25T06:01:00Z"),
                null,
                null,
                "unknown"
        );

        int workers = 8;
        ExecutorService executor = Executors.newFixedThreadPool(workers);
        CountDownLatch start = new CountDownLatch(1);

        try {
            List<Future<UUID>> futures = java.util.stream.IntStream
                    .range(0, workers)
                    .mapToObj(index -> executor.submit(() -> {
                        start.await();
                        return solutionService.upsert(
                                principal,
                                "race-id",
                                request
                        ).id();
                    }))
                    .toList();

            start.countDown();
            Set<UUID> ids = new HashSet<>();
            for (Future<UUID> future : futures) {
                ids.add(future.get());
            }

            assertThat(ids).hasSize(1);
            assertThat(solutionRepository.countByUserIdAndClientRecordId(
                    user.user().getId(),
                    "race-id"
            )).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void validationErrorsDoNotEchoSourceOrBearerToken()
            throws Exception {
        TestUser user = createAuthenticatedUser(5005L, "privacy");
        String sourceMarker = "SOURCE_SECRET_MARKER_987654";

        String response = mockMvc.perform(
                        put("/api/v1/solutions/by-client-id/privacy-id")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {
                                          "platform": "OTHER",
                                          "problemNumber": "1234",
                                          "title": "Privacy",
                                          "language": "Java",
                                          "code": "%s",
                                          "result": "ACCEPTED",
                                          "aiUsage": "unknown"
                                        }
                                        """.formatted(sourceMarker))
                )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code")
                        .value("PLATFORM_NOT_SUPPORTED"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertThat(response).doesNotContain(sourceMarker);
        assertThat(response).doesNotContain(user.token());
    }

    private TestUser createAuthenticatedUser(
            long githubUserId,
            String login
    ) {
        Instant now = Instant.now();
        CodeArchiveUser user = userRepository.save(
                CodeArchiveUser.create(
                        new GitHubUserProfile(
                                githubUserId,
                                login,
                                login,
                                null
                        ),
                        now
                )
        );
        String token = "test-token-" + UUID.randomUUID();
        AuthSession session = authSessionRepository.save(
                AuthSession.create(
                        user.getId(),
                        tokenCodec.hash(token),
                        now.plusSeconds(3600),
                        now
                )
        );
        return new TestUser(user, session, token);
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private String basePayload(
            String title,
            String executionTime,
            String memoryUsage,
            String aiUsage
    ) {
        return """
                {
                  "platform": "SWEA",
                  "problemNumber": "1234",
                  "title": "%s",
                  "language": "Java",
                  "code": "public class Main {}",
                  "result": "ACCEPTED",
                  "solvedAt": "2026-08-25T06:00:00Z",
                  "observedAt": "2026-08-25T06:01:00Z",
                  "executionTime": %s,
                  "memoryUsage": %s,
                  "aiUsage": "%s"
                }
                """.formatted(
                title,
                jsonNullable(executionTime),
                jsonNullable(memoryUsage),
                aiUsage
        );
    }

    private String jsonNullable(String value) {
        return value == null
                ? "null"
                : "\"" + value + "\"";
    }

    private record TestUser(
            CodeArchiveUser user,
            AuthSession session,
            String token
    ) {
    }
}
