package com.codearchive.api.solution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

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
class SolutionDeleteIntegrationTest {

    private static final String DASHBOARD_ORIGIN =
            "https://codearchive-dashboard-beta.onrender.com";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired private MockMvc mockMvc;
    @Autowired private UserRepository userRepository;
    @Autowired private AuthSessionRepository authSessionRepository;
    @Autowired private SecureTokenCodec tokenCodec;
    @Autowired private SolutionRepository solutionRepository;

    @AfterEach
    void cleanDatabase() {
        solutionRepository.deleteAllInBatch();
        authSessionRepository.deleteAllInBatch();
        userRepository.deleteAllInBatch();
    }

    @Test
    void authenticatedBearerOwnerDeletesOnlyOwnSolutionAndRepeatIsNotFound()
            throws Exception {
        TestUser owner = createAuthenticatedUser(2101L, "owner");
        UUID target = createSolution(owner, "delete-me", "Delete me");
        UUID unrelated = createSolution(owner, "keep-me", "Keep me");

        mockMvc.perform(delete("/api/v1/solutions/{id}", target)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));

        assertThat(solutionRepository.findById(target)).isEmpty();
        assertThat(solutionRepository.findById(unrelated)).isPresent();

        mockMvc.perform(delete("/api/v1/solutions/{id}", target)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("SOLUTION_NOT_FOUND"));
    }

    @Test
    void unauthenticatedDeleteIsRejected() throws Exception {
        mockMvc.perform(delete("/api/v1/solutions/{id}", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void foreignAndMissingSolutionHaveIdenticalNotFoundContract()
            throws Exception {
        TestUser owner = createAuthenticatedUser(2201L, "owner-a");
        TestUser other = createAuthenticatedUser(2202L, "owner-b");
        UUID target = createSolution(owner, "private-id", "Private");
        UUID missing = UUID.randomUUID();

        mockMvc.perform(delete("/api/v1/solutions/{id}", target)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other.token())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("SOLUTION_NOT_FOUND"));

        mockMvc.perform(delete("/api/v1/solutions/{id}", missing)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other.token())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("SOLUTION_NOT_FOUND"));

        assertThat(solutionRepository.findById(target)).isPresent();
    }

    @Test
    void cookieDeleteRequiresExactDashboardOriginAndExactOriginSucceeds()
            throws Exception {
        TestUser owner = createAuthenticatedUser(2301L, "cookie-owner");
        UUID target = createSolution(owner, "cookie-delete", "Cookie delete");

        mockMvc.perform(delete("/api/v1/solutions/{id}", target)
                        .cookie(sessionCookie(owner.token())))
                .andExpect(status().isForbidden());
        assertThat(solutionRepository.findById(target)).isPresent();

        mockMvc.perform(delete("/api/v1/solutions/{id}", target)
                        .cookie(sessionCookie(owner.token()))
                        .header(HttpHeaders.ORIGIN, DASHBOARD_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));
        assertThat(solutionRepository.findById(target)).isEmpty();
    }

    private UUID createSolution(TestUser user, String clientRecordId, String title)
            throws Exception {
        mockMvc.perform(put("/api/v1/solutions/by-client-id/{clientRecordId}", clientRecordId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(user.token()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload(title)))
                .andExpect(status().isOk());
        return solutionRepository.findByUserIdAndClientRecordId(
                user.user().getId(), clientRecordId).orElseThrow().getId();
    }

    private TestUser createAuthenticatedUser(long githubUserId, String login) {
        Instant now = Instant.now();
        CodeArchiveUser user = userRepository.save(CodeArchiveUser.create(
                new GitHubUserProfile(githubUserId, login, login, null), now));
        String token = "synthetic-delete-token-" + UUID.randomUUID();
        AuthSession session = authSessionRepository.save(AuthSession.create(
                user.getId(), tokenCodec.hash(token), now.plusSeconds(3600), now));
        return new TestUser(user, session, token);
    }

    private MockCookie sessionCookie(String token) {
        return new MockCookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, token);
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private String payload(String title) {
        return """
                {
                  "platform": "SWEA",
                  "problemNumber": "1234",
                  "title": "%s",
                  "language": "Java",
                  "code": "public class Main {}",
                  "result": "ACCEPTED",
                  "solvedAt": "2026-08-30T01:00:00Z",
                  "observedAt": "2026-08-30T01:00:01Z",
                  "aiUsage": "unknown"
                }
                """.formatted(title);
    }

    private record TestUser(
            CodeArchiveUser user,
            AuthSession session,
            String token
    ) {
    }
}
