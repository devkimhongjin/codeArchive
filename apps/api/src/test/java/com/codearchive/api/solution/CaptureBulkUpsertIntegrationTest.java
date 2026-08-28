package com.codearchive.api.solution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSession;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserRepository;

@SpringBootTest(properties = {
        "DB_PASSWORD=test-only",
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"
})
@AutoConfigureMockMvc
@Testcontainers
class CaptureBulkUpsertIntegrationTest {

    private static final String DASHBOARD_ORIGIN =
            "https://codearchive-dashboard-beta.onrender.com";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AuthSessionRepository authSessionRepository;

    @Autowired
    private SecureTokenCodec tokenCodec;

    @Autowired
    private SolutionRepository solutionRepository;

    @Autowired
    private CaptureBulkUpsertService captureBulkUpsertService;

    @AfterEach
    void cleanDatabase() {
        solutionRepository.deleteAllInBatch();
        authSessionRepository.deleteAllInBatch();
        userRepository.deleteAllInBatch();
    }

    @Test
    void unauthenticatedBulkRequestIsRejected() throws Exception {
        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(record("unauth-id", "Unauth")))
                )
                .andExpect(status().isUnauthorized());
    }

    @Test
    void dashboardCookieWithExactOriginIsAccepted() throws Exception {
        TestUser user = createAuthenticatedUser(1101L, "cookie-user");

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .cookie(sessionCookie(user.token()))
                                .header(HttpHeaders.ORIGIN, DASHBOARD_ORIGIN)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(record("cookie-id", "Cookie")))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].clientRecordId")
                        .value("cookie-id"))
                .andExpect(jsonPath("$.data.results[0].outcome")
                        .value("IMPORTED"))
                .andExpect(jsonPath("$.data.results[0].ackEligible")
                        .value(true));
    }

    @Test
    void bearerCompatibilityIsPreserved() throws Exception {
        TestUser user = createAuthenticatedUser(1201L, "bearer-user");

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(record("bearer-id", "Bearer")))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].outcome")
                        .value("IMPORTED"));
    }

    @Test
    void batchLargerThanTwentyFiveIsRejected() throws Exception {
        TestUser user = createAuthenticatedUser(1301L, "bounded-user");
        String records = IntStream.range(0, 26)
                .mapToObj(index -> record("id-" + index, "Title " + index))
                .reduce((left, right) -> left + "," + right)
                .orElseThrow();

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"records\":[" + records + "]}")
                )
                .andExpect(status().isBadRequest());

        assertThat(solutionRepository.count()).isZero();
    }

    @Test
    void malformedItemFailsWithoutInvalidatingSuccessfulSibling()
            throws Exception {
        TestUser user = createAuthenticatedUser(1401L, "partial-user");
        String sourceMarker = "SOURCE_MARKER_DO_NOT_ECHO";
        String invalid = record(
                "invalid-id",
                "Invalid",
                "OTHER",
                sourceMarker
        );

        String response = mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(
                                        record("valid-id", "Valid"),
                                        invalid
                                ))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].clientRecordId")
                        .value("valid-id"))
                .andExpect(jsonPath("$.data.results[0].outcome")
                        .value("IMPORTED"))
                .andExpect(jsonPath("$.data.results[0].ackEligible")
                        .value(true))
                .andExpect(jsonPath("$.data.results[1].clientRecordId")
                        .value("invalid-id"))
                .andExpect(jsonPath("$.data.results[1].outcome")
                        .value("FAILED"))
                .andExpect(jsonPath("$.data.results[1].ackEligible")
                        .value(false))
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                user.user().getId(),
                "valid-id"
        )).isEqualTo(1);
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                user.user().getId(),
                "invalid-id"
        )).isZero();
        assertThat(response).doesNotContain(sourceMarker);
        assertThat(response).doesNotContain(user.token());
    }

    @Test
    void replayPersistsOnceReturnsExistingAndDoesNotOverwrite()
            throws Exception {
        TestUser user = createAuthenticatedUser(1501L, "replay-user");

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(record("stable-id", "Original")))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].outcome")
                        .value("IMPORTED"));

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(record("stable-id", "Changed")))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].clientRecordId")
                        .value("stable-id"))
                .andExpect(jsonPath("$.data.results[0].outcome")
                        .value("EXISTING"))
                .andExpect(jsonPath("$.data.results[0].ackEligible")
                        .value(true));

        Solution stored = solutionRepository
                .findByUserIdAndClientRecordId(
                        user.user().getId(),
                        "stable-id"
                )
                .orElseThrow();

        assertThat(stored.getTitle()).isEqualTo("Original");
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                user.user().getId(),
                "stable-id"
        )).isEqualTo(1);
    }

    @Test
    void concurrentDuplicateCannotCreateDuplicateRows()
            throws Exception {
        TestUser user = createAuthenticatedUser(1601L, "race-user");
        CodeArchivePrincipal principal = principal(user);
        CaptureBulkUpsertRequest request = request(
                "race-id",
                "Concurrent"
        );
        int workers = 8;
        ExecutorService executor = Executors.newFixedThreadPool(workers);
        CountDownLatch start = new CountDownLatch(1);

        try {
            List<Future<CaptureBulkUpsertResponse.Outcome>> futures =
                    IntStream.range(0, workers)
                            .mapToObj(index -> executor.submit(() -> {
                                start.await();
                                return captureBulkUpsertService
                                        .bulkUpsert(principal, request)
                                        .results()
                                        .getFirst()
                                        .outcome();
                            }))
                            .toList();

            start.countDown();
            long imported = 0;
            long existing = 0;
            for (Future<CaptureBulkUpsertResponse.Outcome> future : futures) {
                CaptureBulkUpsertResponse.Outcome outcome = future.get();
                if (outcome == CaptureBulkUpsertResponse.Outcome.IMPORTED) {
                    imported++;
                }
                if (outcome == CaptureBulkUpsertResponse.Outcome.EXISTING) {
                    existing++;
                }
            }

            assertThat(imported).isEqualTo(1);
            assertThat(existing).isEqualTo(workers - 1);
            assertThat(solutionRepository.countByUserIdAndClientRecordId(
                    user.user().getId(),
                    "race-id"
            )).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void differentUsersMayUseSameClientIdWithoutExistenceLeakage()
            throws Exception {
        TestUser userA = createAuthenticatedUser(1701L, "user-a");
        TestUser userB = createAuthenticatedUser(1702L, "user-b");

        CaptureBulkUpsertResponse responseA = captureBulkUpsertService.bulkUpsert(
                principal(userA),
                request("shared-id", "A private title")
        );
        CaptureBulkUpsertResponse responseB = captureBulkUpsertService.bulkUpsert(
                principal(userB),
                request("shared-id", "B title")
        );

        assertThat(responseA.results().getFirst().outcome())
                .isEqualTo(CaptureBulkUpsertResponse.Outcome.IMPORTED);
        assertThat(responseB.results().getFirst().outcome())
                .isEqualTo(CaptureBulkUpsertResponse.Outcome.IMPORTED);
        assertThat(responseB.results().getFirst().clientRecordId())
                .isEqualTo("shared-id");
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                userA.user().getId(),
                "shared-id"
        )).isEqualTo(1);
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                userB.user().getId(),
                "shared-id"
        )).isEqualTo(1);
        assertThat(solutionRepository.count()).isEqualTo(2);
    }

    @Test
    void responseCorrelatesEveryRecordByClientRecordId() throws Exception {
        TestUser user = createAuthenticatedUser(1801L, "correlation-user");

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(user.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(
                                        record("first-id", "First"),
                                        record("second-id", "Second")
                                ))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].clientRecordId")
                        .value("first-id"))
                .andExpect(jsonPath("$.data.results[1].clientRecordId")
                        .value("second-id"));
    }

    @Test
    void suppliedUserIdCannotOverrideAuthenticatedOwner() throws Exception {
        TestUser attemptedOwner = createAuthenticatedUser(1901L, "attempted");
        TestUser authenticated = createAuthenticatedUser(1902L, "authenticated");
        String item = record("owner-id", "Owned");
        item = item.substring(0, item.length() - 1)
                + ",\"userId\":\""
                + attemptedOwner.user().getId()
                + "\"}";

        mockMvc.perform(
                        post("/api/v1/solutions/bulk-upsert")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        bearer(authenticated.token())
                                )
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(item))
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].outcome")
                        .value("IMPORTED"));

        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                attemptedOwner.user().getId(),
                "owner-id"
        )).isZero();
        assertThat(solutionRepository.countByUserIdAndClientRecordId(
                authenticated.user().getId(),
                "owner-id"
        )).isEqualTo(1);
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
        String token = "synthetic-test-token-" + UUID.randomUUID();
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

    private MockCookie sessionCookie(String token) {
        return new MockCookie(
                ApiAuthenticationFilter.SESSION_COOKIE_NAME,
                token
        );
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private CaptureBulkUpsertRequest request(
            String clientRecordId,
            String title
    ) {
        return new CaptureBulkUpsertRequest(
                List.of(new CaptureBulkUpsertRequest.CaptureItem(
                        clientRecordId,
                        "SWEA",
                        "1234",
                        title,
                        "Java",
                        "public class Main {}",
                        "ACCEPTED",
                        Instant.parse("2026-08-25T06:00:00Z"),
                        Instant.parse("2026-08-25T06:01:00Z"),
                        null,
                        null,
                        "unknown"
                )),
                "synthetic-import-batch"
        );
    }

    private String batch(String... records) {
        return "{\"records\":[" + String.join(",", records)
                + "],\"importBatchId\":\"synthetic-batch\"}";
    }

    private String record(String clientRecordId, String title) {
        return record(
                clientRecordId,
                title,
                "SWEA",
                "public class Main {}"
        );
    }

    private String record(
            String clientRecordId,
            String title,
            String platform,
            String code
    ) {
        return """
                {
                  "clientRecordId": "%s",
                  "platform": "%s",
                  "problemNumber": "1234",
                  "title": "%s",
                  "language": "Java",
                  "code": "%s",
                  "result": "ACCEPTED",
                  "solvedAt": "2026-08-25T06:00:00Z",
                  "observedAt": "2026-08-25T06:01:00Z",
                  "aiUsage": "unknown"
                }
                """.formatted(
                clientRecordId,
                platform,
                title,
                code
        ).trim();
    }

    private record TestUser(
            CodeArchiveUser user,
            AuthSession session,
            String token
    ) {
    }
}
