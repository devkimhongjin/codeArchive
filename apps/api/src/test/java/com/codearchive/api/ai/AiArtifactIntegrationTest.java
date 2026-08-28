package com.codearchive.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.ai.AnalysisClient.AnalysisResult;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSession;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserRepository;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import com.codearchive.api.solution.SolutionService;
import com.codearchive.api.solution.SolutionUpsertRequest;

import jakarta.persistence.EntityManagerFactory;

@SpringBootTest(properties = {
        "DB_PASSWORD=test-only",
        "codearchive.ai.daily-request-limit=3",
        "codearchive.analysis.internal-token=INTERNAL_SECRET_MARKER"
})
@AutoConfigureMockMvc
@Testcontainers
class AiArtifactIntegrationTest {

    private static final String SOURCE =
            "public class Main { static final String X = \"SOURCE_MARKER\"; }";

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

    @Autowired
    private AiArtifactRepository artifactRepository;

    @Autowired
    private AiArtifactService artifactService;

    @MockitoBean
    private AnalysisClient analysisClient;

    @AfterEach
    void cleanDatabase() {
        artifactRepository.deleteAllInBatch();
        jdbcTemplate.update("DELETE FROM ai_daily_usage");
        solutionRepository.deleteAllInBatch();
        authSessionRepository.deleteAllInBatch();
        userRepository.deleteAllInBatch();
    }

    @Test
    void flywayV1ThroughV4ApplyAndHibernateValidateStarts() {
        Integer applied = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history "
                        + "WHERE version IN ('1', '2', '3', '4') "
                        + "AND success = true",
                Integer.class
        );
        String artifactTable = jdbcTemplate.queryForObject(
                "SELECT to_regclass('public.ai_artifacts')::text",
                String.class
        );
        String quotaTable = jdbcTemplate.queryForObject(
                "SELECT to_regclass('public.ai_daily_usage')::text",
                String.class
        );

        assertThat(POSTGRES.isRunning()).isTrue();
        assertThat(applied).isEqualTo(4);
        assertThat(artifactTable).isEqualTo("ai_artifacts");
        assertThat(quotaTable).isEqualTo("ai_daily_usage");
        assertThat(entityManagerFactory.isOpen()).isTrue();
    }

    @Test
    void ownSolutionCreatesThreeArtifactsWithoutChangingOriginalCode()
            throws Exception {
        TestUser user = createAuthenticatedUser(6101L, "artifact-owner");
        Solution solution = createSolution(user, "three-types");

        when(analysisClient.analyze(any())).thenAnswer(invocation -> {
            AnalysisClient.AnalysisRequest request = invocation.getArgument(0);
            assertThat(request.code()).isEqualTo(SOURCE);
            assertThat(request.platform()).isEqualTo("SWEA");
            assertThat(request.problemNumber()).isEqualTo("1234");
            assertThat(request.title()).isEqualTo("AI Example");
            assertThat(request.language()).isEqualTo("Java");
            return new AnalysisResult(
                    "artifact:" + request.task().name(),
                    "fake",
                    "fake-v1"
            );
        });

        for (AiArtifactType type : AiArtifactType.values()) {
            mockMvc.perform(
                            post(
                                    "/api/v1/solutions/{id}/ai-artifacts",
                                    solution.getId()
                            )
                                    .header(
                                            HttpHeaders.AUTHORIZATION,
                                            bearer(user.token())
                                    )
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"type\":\"" + type.name() + "\"}")
                    )
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.type").value(type.name()))
                    .andExpect(jsonPath("$.data.provider").value("fake"))
                    .andExpect(jsonPath("$.data.model").value("fake-v1"));
        }

        Solution unchanged = solutionRepository.findById(solution.getId())
                .orElseThrow();
        assertThat(unchanged.getCode()).isEqualTo(SOURCE);
        assertThat(artifactRepository.findAll()).hasSize(3);
        assertThat(quotaCount(user.user().getId())).isEqualTo(3);

        mockMvc.perform(
                        get(
                                "/api/v1/solutions/{id}/ai-artifacts",
                                solution.getId()
                        )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(3));
    }

    @Test
    void crossUserSolutionAndArtifactAccessAreHidden()
            throws Exception {
        TestUser owner = createAuthenticatedUser(6201L, "owner");
        TestUser other = createAuthenticatedUser(6202L, "other");
        Solution solution = createSolution(owner, "owned-solution");

        mockMvc.perform(
                        post(
                                "/api/v1/solutions/{id}/ai-artifacts",
                                solution.getId()
                        )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(other.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"type\":\"CODE_REVIEW\"}")
                )
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code")
                        .value("SOLUTION_NOT_FOUND"));

        verify(analysisClient, never()).analyze(any());
        assertThat(quotaCount(other.user().getId())).isZero();

        when(analysisClient.analyze(any())).thenReturn(
                new AnalysisResult("review", "fake", "fake-v1")
        );
        AiArtifactResponse created = artifactService.create(
                principal(owner),
                solution.getId(),
                new AiArtifactCreateRequest(AiArtifactType.CODE_REVIEW)
        );

        mockMvc.perform(
                        get(
                                "/api/v1/ai-artifacts/{id}",
                                created.id()
                        )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(other.token())
                                )
                )
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code")
                        .value("AI_ARTIFACT_NOT_FOUND"));
    }

    @Test
    void publicCreateRejectsClientSuppliedSourceBeforeQuotaOrProvider()
            throws Exception {
        TestUser user = createAuthenticatedUser(6301L, "strict-input");
        Solution solution = createSolution(user, "strict-input");

        mockMvc.perform(
                        post(
                                "/api/v1/solutions/{id}/ai-artifacts",
                                solution.getId()
                        )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {
                                          "type": "CODE_REVIEW",
                                          "code": "ATTACKER_SOURCE"
                                        }
                                        """)
                )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code")
                        .value("INVALID_REQUEST"));

        verify(analysisClient, never()).analyze(any());
        assertThat(quotaCount(user.user().getId())).isZero();
        assertThat(artifactRepository.count()).isZero();
    }

    @Test
    void dailyQuotaIsPerUserAndConcurrencySafe()
            throws Exception {
        TestUser userA = createAuthenticatedUser(6401L, "quota-a");
        TestUser userB = createAuthenticatedUser(6402L, "quota-b");
        Solution solutionA = createSolution(userA, "quota-a");
        Solution solutionB = createSolution(userB, "quota-b");

        when(analysisClient.analyze(any())).thenReturn(
                new AnalysisResult("ok", "fake", "fake-v1")
        );

        int workers = 8;
        ExecutorService executor = Executors.newFixedThreadPool(workers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<ErrorCode>> futures = new ArrayList<>();

        try {
            for (int i = 0; i < workers; i++) {
                futures.add(executor.submit(() -> {
                    start.await();
                    try {
                        artifactService.create(
                                principal(userA),
                                solutionA.getId(),
                                new AiArtifactCreateRequest(
                                        AiArtifactType.CODE_REVIEW
                                )
                        );
                        return null;
                    } catch (CodeArchiveException exception) {
                        return exception.getErrorCode();
                    }
                }));
            }
            start.countDown();

            int success = 0;
            int rateLimited = 0;
            for (Future<ErrorCode> future : futures) {
                ErrorCode result = future.get();
                if (result == null) {
                    success++;
                } else if (result == ErrorCode.RATE_LIMITED) {
                    rateLimited++;
                }
            }

            assertThat(success).isEqualTo(3);
            assertThat(rateLimited).isEqualTo(5);
            assertThat(quotaCount(userA.user().getId())).isEqualTo(3);
            assertThat(artifactRepository.findOwnedBySolutionId(
                    solutionA.getId(),
                    userA.user().getId()
            )).hasSize(3);

            artifactService.create(
                    principal(userB),
                    solutionB.getId(),
                    new AiArtifactCreateRequest(AiArtifactType.CODE_REVIEW)
            );
            assertThat(quotaCount(userB.user().getId())).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void providerFailureConsumesAttemptButCreatesNoPartialArtifact()
            throws Exception {
        TestUser user = createAuthenticatedUser(6501L, "provider-failure");
        Solution solution = createSolution(user, "provider-failure");

        when(analysisClient.analyze(any())).thenThrow(
                new CodeArchiveException(ErrorCode.EXTERNAL_API_ERROR)
        );

        for (int i = 0; i < 3; i++) {
            try {
                artifactService.create(
                        principal(user),
                        solution.getId(),
                        new AiArtifactCreateRequest(AiArtifactType.CODE_REVIEW)
                );
            } catch (CodeArchiveException exception) {
                assertThat(exception.getErrorCode())
                        .isEqualTo(ErrorCode.EXTERNAL_API_ERROR);
            }
        }

        assertThat(quotaCount(user.user().getId())).isEqualTo(3);
        assertThat(artifactRepository.count()).isZero();
        assertThat(solutionRepository.findById(solution.getId())
                .orElseThrow().getCode()).isEqualTo(SOURCE);

        try {
            artifactService.create(
                    principal(user),
                    solution.getId(),
                    new AiArtifactCreateRequest(AiArtifactType.CODE_REVIEW)
            );
        } catch (CodeArchiveException exception) {
            assertThat(exception.getErrorCode())
                    .isEqualTo(ErrorCode.RATE_LIMITED);
        }
        verify(analysisClient, times(3)).analyze(any());

        String response = mockMvc.perform(
                        post(
                                "/api/v1/solutions/{id}/ai-artifacts",
                                solution.getId()
                        )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"type\":\"CODE_REVIEW\"}")
                )
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertThat(response).doesNotContain(SOURCE);
        assertThat(response).doesNotContain(user.token());
        assertThat(response).doesNotContain("INTERNAL_SECRET_MARKER");
    }

    private Solution createSolution(TestUser user, String clientRecordId) {
        UUID id = solutionService.upsert(
                principal(user),
                clientRecordId,
                new SolutionUpsertRequest(
                        "SWEA",
                        "1234",
                        "AI Example",
                        "Java",
                        SOURCE,
                        "ACCEPTED",
                        Instant.parse("2026-08-25T08:00:00Z"),
                        Instant.parse("2026-08-25T08:01:00Z"),
                        null,
                        null,
                        "unknown"
                )
        ).id();
        return solutionRepository.findById(id).orElseThrow();
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

    private CodeArchivePrincipal principal(TestUser user) {
        return new CodeArchivePrincipal(
                user.user().getId(),
                user.session().getId(),
                user.user().getGithubLogin()
        );
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private int quotaCount(UUID userId) {
        Integer count = jdbcTemplate.queryForObject(
                """
                SELECT COALESCE(MAX(request_count), 0)
                FROM ai_daily_usage
                WHERE user_id = ?
                  AND usage_date = ?
                """,
                Integer.class,
                userId,
                LocalDate.now(ZoneOffset.UTC)
        );
        return count == null ? 0 : count;
    }

    private record TestUser(
            CodeArchiveUser user,
            AuthSession session,
            String token
    ) {
    }
}
