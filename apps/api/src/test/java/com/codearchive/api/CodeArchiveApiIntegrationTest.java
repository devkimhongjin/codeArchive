package com.codearchive.api;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.GithubAccountService;
import com.codearchive.api.auth.GithubIdentity;
import com.codearchive.api.auth.GithubOAuth2User;
import com.codearchive.api.auth.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import jakarta.servlet.http.Cookie;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "codearchive.github.client-id=",
        "codearchive.github.client-secret=",
        "codearchive.github.redirect-uri=http://localhost:5173/api/login/oauth2/code/github",
        "codearchive.github.dashboard-origin=http://localhost:5173"
})
class CodeArchiveApiIntegrationTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    UserRepository userRepository;

    @Autowired
    com.codearchive.api.solution.SolutionRepository solutionRepository;

    @Autowired
    com.codearchive.api.relay.RelayGrantRepository relayGrantRepository;

    @Autowired
    com.codearchive.api.settings.UserSettingsRepository userSettingsRepository;

    @Autowired
    com.codearchive.api.automation.GithubCommitJobRepository githubCommitJobRepository;

    @Autowired
    GithubAccountService githubAccountService;

    @Autowired
    @SuppressWarnings("rawtypes")
    SessionRepository sessionRepository;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    org.springframework.transaction.PlatformTransactionManager transactionManager;

    @Autowired
    CookieSerializer cookieSerializer;

    @BeforeEach
    void clearUsers() {
        githubCommitJobRepository.deleteAll();
        relayGrantRepository.deleteAll();
        userSettingsRepository.deleteAll();
        solutionRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void csrfEndpointReturnsTokenAndCookie() throws Exception {
        mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.headerName", is("X-XSRF-TOKEN")))
                .andExpect(jsonPath("$.token").isString())
                .andExpect(cookie().exists("XSRF-TOKEN"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void githubLoginSessionPersistsForThirtyDays() {
        Session session = (Session) sessionRepository.createSession();
        org.assertj.core.api.Assertions.assertThat(session.getMaxInactiveInterval())
                .isEqualTo(Duration.ofDays(30));

        MockHttpServletResponse response = new MockHttpServletResponse();
        cookieSerializer.writeCookieValue(new CookieSerializer.CookieValue(
                new MockHttpServletRequest(), response, "persistent-session"));

        org.assertj.core.api.Assertions.assertThat(response.getHeader("Set-Cookie"))
                .contains("JSESSIONID=", "Max-Age=2592000", "HttpOnly", "SameSite=Lax");
    }

    @Test
    void actuatorHealthIsPublicWithoutMakingOtherActuatorEndpointsPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("UP")));
        mockMvc.perform(get("/actuator/env"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void providersReportDisabledAndLegacyPasswordAuthIsGone() throws Exception {
        mockMvc.perform(get("/api/auth/providers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.github.enabled", is(false)))
                .andExpect(jsonPath("$.github.loginUrl", is("/api/oauth2/authorization/github")));

        mockMvc.perform(get("/api/oauth2/authorization/github"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.message", is("GitHub login is unavailable")));

        mockMvc.perform(post("/api/auth/register").with(csrf().asHeader()))
                .andExpect(status().isGone());
        mockMvc.perform(post("/api/auth/login").with(csrf().asHeader()))
                .andExpect(status().isGone());
    }

    @Test
    void githubIdIsTheImmutableAccountKeyAndProfileFieldsRefresh() throws Exception {
        githubAccountService.upsert(principal("1001", "old-login", "Old Name", null));
        githubAccountService.upsert(principal("1001", "new-login", "New Name", "new@example.com"));

        org.assertj.core.api.Assertions.assertThat(userRepository.count()).isEqualTo(1);
        AppUser user = userRepository.findByGithubId("1001").orElseThrow();
        org.assertj.core.api.Assertions.assertThat(user.getGithubLogin()).isEqualTo("new-login");
        org.assertj.core.api.Assertions.assertThat(user.getGithubEmail()).isEqualTo("new@example.com");

        mockMvc.perform(get("/api/auth/me").with(githubLogin("1001", "new-login", "New Name", "new@example.com")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.githubId", is("1001")))
                .andExpect(jsonPath("$.githubLogin", is("new-login")))
                .andExpect(jsonPath("$.name", is("New Name")))
                .andExpect(jsonPath("$.email", is("new@example.com")))
                .andExpect(jsonPath("$.avatarUrl", is("https://avatars.githubusercontent.com/u/1001?v=4")));
    }

    @Test
    void missingGithubEmailIsAllowedAndLegacyUsernameSessionsCannotAuthorize() throws Exception {
        githubAccountService.upsert(principal("1002", "octocat", "Octo", null));
        mockMvc.perform(get("/api/auth/me").with(githubLogin("1002", "octocat", "Octo", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.githubId", is("1002")))
                .andExpect(jsonPath("$.email").doesNotExist());

        userRepository.save(new AppUser("legacy@example.com", "legacy-hash"));
        mockMvc.perform(get("/api/auth/me").with(user("legacy@example.com")))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/solutions").with(user("legacy@example.com")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logoutInvalidatesGithubSession() throws Exception {
        githubAccountService.upsert(principal("1003", "logout-user", "Logout", null));
        enableRelay("1003", "logout-user", "Logout");
        String device="dashboardrelaylogout01";
        MvcResult issued=mockMvc.perform(post("/api/relay/grants").with(csrf().asHeader())
                        .with(githubLogin("1003", "logout-user", "Logout", null)).header("X-CodeArchive-Github-Id", "1003").contentType("application/json")
                        .content("{\"deviceId\":\""+device+"\",\"generation\":1}"))
                .andExpect(status().isOk()).andReturn();
        String secret=objectMapper.readTree(issued.getResponse().getContentAsString()).path("secret").asText();
        Cookie session = persistedGithubSession("1003", "logout-user", "Logout", null);
        mockMvc.perform(get("/api/auth/me").cookie(session))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/logout").cookie(session).with(csrf().asHeader()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/auth/me").cookie(session))
                .andExpect(status().isUnauthorized());
        // This is a separate request/transaction, proving logout persisted the
        // revocation instead of mutating only a detached grant entity.
        mockMvc.perform(post("/api/relay/captures").header("Authorization", "Bearer "+secret)
                        .contentType("application/json").content(capture(UUID.randomUUID().toString(), "after logout")))
                .andExpect(status().isUnauthorized());
        var afterLogout=userSettingsRepository.findByUserId(userRepository.findByGithubId("1003").orElseThrow().getId()).orElseThrow();
        org.assertj.core.api.Assertions.assertThat(afterLogout.isAutoSyncEnabled()).isFalse();
        org.assertj.core.api.Assertions.assertThat(afterLogout.isGithubAutoCommitEnabled()).isFalse();
    }

    @Test
    void githubSolutionsAreIdempotentIsolatedAndAccountAssertionUsesGithubId() throws Exception {
        githubAccountService.upsert(principal("101", "first", "First", null));
        githubAccountService.upsert(principal("202", "second", "Second", null));
        String captureId = UUID.randomUUID().toString();
        String firstPayload = capture(captureId, "first source");

        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("101", "first", "First", null))
                        .header("X-CodeArchive-Account", "101")
                        .contentType("application/json")
                        .content("{\"captures\":[" + firstPayload + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)))
                .andExpect(jsonPath("$.failures", hasSize(0)));

        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("101", "first", "First", null))
                        .header("X-CodeArchive-Account", "101")
                        .contentType("application/json")
                        .content("{\"captures\":[" + capture(captureId, "updated source") + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds", hasSize(0)))
                .andExpect(jsonPath("$.failures", hasSize(1)));

        mockMvc.perform(get("/api/solutions").with(githubLogin("101", "first", "First", null))
                        .header("X-CodeArchive-Account", "101"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].sourceCode", is("first source")))
                .andExpect(jsonPath("$[0].language", is("JAVA")))
                .andExpect(jsonPath("$[0].languageKey", is("java")));

        mockMvc.perform(get("/api/solutions").with(githubLogin("202", "second", "Second", null))
                        .header("X-CodeArchive-Account", "202"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));

        mockMvc.perform(get("/api/solutions").with(githubLogin("202", "second", "Second", null))
                        .header("X-CodeArchive-Account", "101"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("Account context changed; refresh and retry")));

        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("202", "second", "Second", null))
                        .header("X-CodeArchive-Account", "202")
                        .contentType("application/json")
                        .content("{\"captures\":[" + firstPayload + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)));
    }

    @Test
    void bulkSyncKeepsValidItemsWhenOtherCapturesFailValidation() throws Exception {
        githubAccountService.upsert(principal("303", "partial", "Partial", null));
        String valid = capture(UUID.randomUUID().toString(), "valid");
        String invalidPlatform = valid.replace("SWEA", "UNKNOWN");
        String invalidDate = valid.replace("2026-01-02T03:04:05Z", "yesterday");

        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("303", "partial", "Partial", null))
                        .contentType("application/json")
                        .content("{\"captures\":[" + valid + "," + invalidPlatform + "," + invalidDate + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)))
                .andExpect(jsonPath("$.failures", hasSize(2)))
                .andExpect(jsonPath("$.failures[0].message").isString())
                .andExpect(jsonPath("$.failures[1].message").isString());
    }

    @Test
    void jungolCaptureSyncsWithItsCanonicalProblemLink() throws Exception {
        githubAccountService.upsert(principal("311", "jungol-user", "Jungol", null));
        String payload = capture(UUID.randomUUID().toString(), "class Main {}")
                .replace("\"platform\":\"SWEA\"", "\"platform\":\"JUNGOL\"")
                .replace("\"problemNumber\":\"1234\"", "\"problemNumber\":\"4577\"")
                .replace("\"problemUrl\":\"https://swexpertacademy.com/problem/1234\"",
                        "\"problemUrl\":\"https://jungol.co.kr/problem/4577\"");
        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("311", "jungol-user", "Jungol", null))
                        .contentType("application/json")
                        .content("{\"captures\":[" + payload + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)));
        mockMvc.perform(get("/api/solutions").with(githubLogin("311", "jungol-user", "Jungol", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].platform", is("JUNGOL")))
                .andExpect(jsonPath("$[0].problemUrl", is("https://jungol.co.kr/problem/4577")));
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void bulkSyncEnqueuesTheSameDurableGithubJobAsRelayDelivery() throws Exception {
        AppUser user = githubAccountService.upsert(principal("304", "manual-recovery", "Manual", null));
        var settings = new com.codearchive.api.settings.UserSettings(user);
        settings.apply(new com.codearchive.api.settings.SettingsRequest(
                0, "Manual", null, false, false, false,
                "{platform}-{number}-{title}", "{platform}/{number}_{title}/{time}",
                "Add {platform} {number} solution",
                "github-light", "github-dark", true, true,
                77L, "manual-recovery", "archive", "main", null));
        userSettingsRepository.saveAndFlush(settings);
        String captureId = UUID.randomUUID().toString();
        String observedAt = java.time.Instant.now().plusSeconds(1).toString();
        String payload = capture(captureId, "manual recovery source")
                .replace("2026-01-02T03:04:05Z", observedAt);

        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("304", "manual-recovery", "Manual", null))
                        .contentType("application/json")
                        .content("{\"captures\":[" + payload + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds[0]", is(captureId)));

        org.assertj.core.api.Assertions.assertThat(
                githubCommitJobRepository.findByUserIdAndCaptureId(user.getId(), captureId))
                .isPresent();
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void historicalBulkSyncNeverEnqueuesGithubEvenWhenAutomationIsEnabled() throws Exception {
        AppUser user = githubAccountService.upsert(principal("305", "historical-owner", "Historical", null));
        var settings = new com.codearchive.api.settings.UserSettings(user);
        settings.apply(new com.codearchive.api.settings.SettingsRequest(
                0, "Historical", null, false, false, false,
                "{platform}-{number}-{title}", "{platform}/{number}_{title}/{time}",
                "Add {platform} {number} solution",
                "github-light", "github-dark", true, true,
                77L, "historical-owner", "archive", "main", null));
        userSettingsRepository.saveAndFlush(settings);
        String captureId = UUID.randomUUID().toString();
        var historical = (com.fasterxml.jackson.databind.node.ObjectNode) objectMapper.readTree(
                capture(captureId, "old accepted source"));
        historical.put("observedAt", java.time.Instant.now().plusSeconds(1).toString());
        historical.put("historicalImport", true);
        historical.put("platform", "JUNGOL");
        historical.put("historicalSubmissionId", "13771703");
        String body = objectMapper.createObjectNode()
                .set("captures", objectMapper.createArrayNode().add(historical)).toString();

        for (int attempt = 0; attempt < 2; attempt++) {
            mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                            .with(githubLogin("305", "historical-owner", "Historical", null))
                            .contentType("application/json").content(body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.acceptedCaptureIds[0]", is(captureId)));
        }
        mockMvc.perform(get("/api/solutions").with(githubLogin("305", "historical-owner", "Historical", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].historicalImport", is(true)))
                .andExpect(jsonPath("$[0].historicalSubmissionId", is("13771703")));
        mockMvc.perform(get("/api/solutions/historical-submission-ids")
                        .with(githubLogin("305", "historical-owner", "Historical", null))
                        .header("X-CodeArchive-Account", "305"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0]", is("13771703")));
        mockMvc.perform(get("/api/solutions/historical-submission-ids"))
                .andExpect(status().isUnauthorized());
        String sameSubmissionDifferentCapture = UUID.randomUUID().toString();
        historical.put("captureId", sameSubmissionDifferentCapture);
        String duplicateBody = objectMapper.createObjectNode()
                .set("captures", objectMapper.createArrayNode().add(historical)).toString();
        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("305", "historical-owner", "Historical", null))
                        .contentType("application/json").content(duplicateBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCaptureIds[0]", is(sameSubmissionDifferentCapture)));
        org.assertj.core.api.Assertions.assertThat(solutionRepository.findByUserIdOrderBySolvedAtDesc(user.getId())).hasSize(1);
        String manualRequest = objectMapper.createObjectNode()
                .put("settingsVersion", settings.getVersion())
                .put("installationId", 77)
                .put("owner", "historical-owner")
                .put("repository", "archive")
                .put("branch", "main")
                .set("submissionIds", objectMapper.createArrayNode().add("13771703")).toString();
        for (int attempt = 0; attempt < 2; attempt++) {
            mockMvc.perform(post("/api/solutions/historical-github-commits").with(csrf().asHeader())
                            .with(githubLogin("305", "historical-owner", "Historical", null))
                            .header("X-CodeArchive-Account", "305")
                            .contentType("application/json").content(manualRequest))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.13771703", is("PENDING")));
        }
        var manualJob = githubCommitJobRepository.findByUserIdAndCaptureId(user.getId(), captureId);
        org.assertj.core.api.Assertions.assertThat(manualJob).isPresent();
        org.assertj.core.api.Assertions.assertThat(manualJob.get().getOrigin())
                .isEqualTo(com.codearchive.api.automation.CommitJobOrigin.HISTORICAL_MANUAL);
        mockMvc.perform(get("/api/solutions/historical-github-status")
                        .with(githubLogin("305", "historical-owner", "Historical", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.13771703", is("PENDING")));
        String changedTarget = manualRequest.replace("\"main\"", "\"develop\"");
        mockMvc.perform(post("/api/solutions/historical-github-commits").with(csrf().asHeader())
                        .with(githubLogin("305", "historical-owner", "Historical", null))
                        .contentType("application/json").content(changedTarget))
                .andExpect(status().isConflict());
        historical.put("captureId", captureId);

        historical.put("historicalImport", false);
        String conflicting = objectMapper.createObjectNode()
                .set("captures", objectMapper.createArrayNode().add(historical)).toString();
        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("305", "historical-owner", "Historical", null))
                        .contentType("application/json").content(conflicting))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.failures[0].captureId", is(captureId)));
        org.assertj.core.api.Assertions.assertThat(
                githubCommitJobRepository.findByUserIdAndCaptureId(user.getId(), captureId)).isPresent();
    }

    @Test
    void bulkSyncRejectsMoreThanFiftyCaptures() throws Exception {
        githubAccountService.upsert(principal("404", "limit", "Limit", null));
        com.fasterxml.jackson.databind.node.ArrayNode captures = objectMapper.createArrayNode();
        for (int index = 0; index < 51; index++) {
            captures.addObject().put("captureId", UUID.randomUUID().toString());
        }
        String body = objectMapper.createObjectNode().set("captures", captures).toString();

        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader())
                        .with(githubLogin("404", "limit", "Limit", null))
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", is("captures cannot contain more than 50 items")));
    }

    @Test
    void multiPlatformHistoricalSyncAndManualBatchAreOwnedAndIdempotent() throws Exception {
        AppUser owner = githubAccountService.upsert(principal("307", "batch-owner", "Batch", null));
        githubAccountService.upsert(principal("308", "other-owner", "Other", null));
        var settings = historicalTarget(owner, "batch-owner");
        String[] platforms = {"SWEA", "PROGRAMMERS", "JUNGOL"};
        String[] identities = {"AaCkP4oKpD3HBISr", "pg:batch:123:2026-01-01T00:00:00.000+09:00:java", "123"};
        var captureIds = objectMapper.createArrayNode();
        for (int i = 0; i < platforms.length; i++) {
            String captureId = UUID.randomUUID().toString(); captureIds.add(captureId);
            var payload = (com.fasterxml.jackson.databind.node.ObjectNode) objectMapper.readTree(capture(captureId, "private source " + i));
            payload.put("platform", platforms[i]); payload.put("historicalImport", true); payload.put("historicalSubmissionId", identities[i]);
            if (platforms[i].equals("PROGRAMMERS")) { payload.put("problemNumber", "123"); payload.put("solvedAt", "2025-12-31T15:00:00.000Z"); }
            String upload = objectMapper.createObjectNode().set("captures", objectMapper.createArrayNode().add(payload)).toString();
            for (int retry = 0; retry < 2; retry++) {
                mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader()).with(githubLogin("307", "batch-owner", "Batch", null))
                    .header("X-CodeArchive-Account", "307").contentType("application/json").content(upload))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.acceptedCaptureIds[0]", is(captureId)));
            }
            mockMvc.perform(get("/api/solutions/historical-submission-ids").param("platform", platforms[i])
                    .with(githubLogin("307", "batch-owner", "Batch", null)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$[0]", is(identities[i])));
        }
        org.assertj.core.api.Assertions.assertThat(githubCommitJobRepository.count()).isZero();
        org.assertj.core.api.Assertions.assertThat(solutionRepository.findByUserIdOrderBySolvedAtDesc(owner.getId())).hasSize(3);
        mockMvc.perform(get("/api/solutions/historical-github-candidates").with(githubLogin("307", "batch-owner", "Batch", null)))
                .andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].state", is("NONE"))).andExpect(jsonPath("$[0].sourceCode").doesNotExist());
        var request = objectMapper.createObjectNode().put("settingsVersion", settings.getVersion()).put("installationId", 77)
                .put("owner", "batch-owner").put("repository", "archive").put("branch", "main");
        request.set("captureIds", captureIds);
        for (int retry = 0; retry < 2; retry++) {
            mockMvc.perform(post("/api/solutions/historical-github-batch").with(csrf().asHeader())
                    .with(githubLogin("307", "batch-owner", "Batch", null)).header("X-CodeArchive-Account", "307")
                    .contentType("application/json").content(request.toString()))
                    .andExpect(status().isOk()).andExpect(jsonPath("$['" + captureIds.get(0).asText() + "']", is("PENDING")));
        }
        org.assertj.core.api.Assertions.assertThat(githubCommitJobRepository.count()).isEqualTo(3);
        mockMvc.perform(post("/api/solutions/historical-github-batch").with(csrf().asHeader())
                .with(githubLogin("308", "other-owner", "Other", null)).header("X-CodeArchive-Account", "307")
                .contentType("application/json").content(request.toString())).andExpect(status().isConflict());
        mockMvc.perform(post("/api/solutions/historical-github-batch").with(csrf().asHeader())
                .with(githubLogin("308", "other-owner", "Other", null)).header("X-CodeArchive-Account", "308")
                .contentType("application/json").content(request.toString())).andExpect(status().isConflict());
        mockMvc.perform(get("/api/solutions/historical-github-candidates")).andExpect(status().isUnauthorized());
        request.put("settingsVersion", settings.getVersion() + 1);
        mockMvc.perform(post("/api/solutions/historical-github-batch").with(csrf().asHeader())
                .with(githubLogin("307", "batch-owner", "Batch", null)).contentType("application/json").content(request.toString()))
                .andExpect(status().isConflict());
    }

    @Test
    void explicitHistoricalRetryKeepsUnknownAndSucceededJobsTerminal() throws Exception {
        AppUser owner = githubAccountService.upsert(principal("309", "retry-owner", "Retry", null));
        var settings = historicalTarget(owner, "retry-owner");
        var ids = objectMapper.createArrayNode();
        var states = new com.codearchive.api.automation.CommitJobState[] { com.codearchive.api.automation.CommitJobState.FAILED,
                com.codearchive.api.automation.CommitJobState.UNKNOWN, com.codearchive.api.automation.CommitJobState.SUCCEEDED };
        for (int i = 0; i < states.length; i++) {
            String id = UUID.randomUUID().toString(); ids.add(id);
            var payload = (com.fasterxml.jackson.databind.node.ObjectNode) objectMapper.readTree(capture(id, "private source " + i));
            payload.put("platform", "SWEA"); payload.put("historicalImport", true); payload.put("historicalSubmissionId", "AaSubmit" + i);
            mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader()).with(githubLogin("309", "retry-owner", "Retry", null))
                    .contentType("application/json").content(objectMapper.createObjectNode().set("captures", objectMapper.createArrayNode().add(payload)).toString()))
                    .andExpect(status().isOk());
            var job = new com.codearchive.api.automation.GithubCommitJob(owner, id, settings.getVersion(), com.codearchive.api.automation.CommitJobOrigin.HISTORICAL_MANUAL);
            job.start(); job.terminal(states[i]); githubCommitJobRepository.saveAndFlush(job);
        }
        var request = objectMapper.createObjectNode().put("settingsVersion", settings.getVersion()).put("installationId", 77)
                .put("owner", "retry-owner").put("repository", "archive").put("branch", "main"); request.set("captureIds", ids);
        mockMvc.perform(post("/api/solutions/historical-github-batch").with(csrf().asHeader())
                .with(githubLogin("309", "retry-owner", "Retry", null)).contentType("application/json").content(request.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$['" + ids.get(0).asText() + "']", is("PENDING")))
                .andExpect(jsonPath("$['" + ids.get(1).asText() + "']", is("UNKNOWN")))
                .andExpect(jsonPath("$['" + ids.get(2).asText() + "']", is("SUCCEEDED")));
        org.assertj.core.api.Assertions.assertThat(githubCommitJobRepository.findByUserIdAndCaptureId(owner.getId(), ids.get(0).asText()).orElseThrow().getAttempts()).isZero();
        org.assertj.core.api.Assertions.assertThat(githubCommitJobRepository.findByUserIdAndCaptureId(owner.getId(), ids.get(0).asText()).orElseThrow().getDeliveryGeneration()).isEqualTo(1);
        mockMvc.perform(post("/api/solutions/historical-github-batch").with(csrf().asHeader())
                .with(githubLogin("309", "retry-owner", "Retry", null)).contentType("application/json").content(request.toString()))
                .andExpect(status().isOk());
        org.assertj.core.api.Assertions.assertThat(githubCommitJobRepository.findByUserIdAndCaptureId(owner.getId(), ids.get(0).asText()).orElseThrow().getDeliveryGeneration()).isEqualTo(1);
    }

    @Test
    void bulkSyncRejectsMismatchedHistoricalIdentityWithoutPersisting() throws Exception {
        AppUser owner = githubAccountService.upsert(principal("310", "invalid-owner", "Invalid", null));
        var payload = (com.fasterxml.jackson.databind.node.ObjectNode) objectMapper.readTree(capture(UUID.randomUUID().toString(), "private source"));
        payload.put("platform", "SWEA"); payload.put("historicalImport", true);
        payload.put("historicalSubmissionId", "pg:other:123:2026-01-01T00:00:00.000+09:00:java");
        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader()).with(githubLogin("310", "invalid-owner", "Invalid", null))
                .contentType("application/json").content(objectMapper.createObjectNode().set("captures", objectMapper.createArrayNode().add(payload)).toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.failures", hasSize(1)));
        org.assertj.core.api.Assertions.assertThat(solutionRepository.findByUserIdOrderBySolvedAtDesc(owner.getId())).isEmpty();
    }

    private com.codearchive.api.settings.UserSettings historicalTarget(AppUser owner, String login) {
        return new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(transaction -> {
            var settings = new com.codearchive.api.settings.UserSettings(userRepository.findById(owner.getId()).orElseThrow());
            settings.apply(new com.codearchive.api.settings.SettingsRequest(0, login, null, false, false, false,
                    "{platform}-{number}", "{platform}/{number}/{capture_ID}", "Add {platform} {number}",
                    "github-light", "github-dark", false, false, 77L, login, "archive", "main", null));
            return userSettingsRepository.saveAndFlush(settings);
        });
    }

    @Test
    void relayGrantDeleteIsCsrfFencedUserScopedAndIdempotent() throws Exception {
        githubAccountService.upsert(principal("501", "first-relay", "First", null));
        githubAccountService.upsert(principal("502", "second-relay", "Second", null));
        enableRelay("501", "first-relay", "First");
        String device = "dashboardrelay0001";
        MvcResult issued = mockMvc.perform(post("/api/relay/grants").with(csrf().asHeader())
                        .with(githubLogin("501", "first-relay", "First", null)).header("X-CodeArchive-Github-Id", "501").contentType("application/json")
                        .content("{\"deviceId\":\"" + device + "\",\"generation\":1}"))
                .andExpect(status().isOk()).andReturn();
        String secret = objectMapper.readTree(issued.getResponse().getContentAsString()).path("secret").asText();
        mockMvc.perform(delete("/api/relay/grants/{deviceId}", device)
                        .with(githubLogin("502", "second-relay", "Second", null)).header("X-CodeArchive-Github-Id", "502").with(csrf().asHeader()))
                .andExpect(status().isNoContent());
        // Cross-account delete neither reveals nor changes the owning grant.
        mockMvc.perform(post("/api/relay/captures").header("Authorization", "Bearer " + secret)
                        .contentType("application/json").content(capture(UUID.randomUUID().toString(), "relay source")))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/api/relay/grants/{deviceId}", device)
                        .with(githubLogin("501", "first-relay", "First", null)).header("X-CodeArchive-Github-Id", "501"))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/relay/grants/{deviceId}", device)
                        .with(githubLogin("501", "first-relay", "First", null)).header("X-CodeArchive-Github-Id", "501").with(csrf().asHeader()))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/relay/captures").header("Authorization", "Bearer " + secret)
                        .contentType("application/json").content(capture(UUID.randomUUID().toString(), "relay source")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void relayStoresOnlyHashRejectsBearerOnNormalRoutesAndValidatesPayload() throws Exception {
        githubAccountService.upsert(principal("551", "relay-hash", "Relay", null)); String device="dashboardrelay0003";
        enableRelay("551", "relay-hash", "Relay");
        MvcResult issued=mockMvc.perform(post("/api/relay/grants").with(csrf().asHeader()).with(githubLogin("551","relay-hash","Relay",null)).header("X-CodeArchive-Github-Id", "551").contentType("application/json").content("{\"deviceId\":\""+device+"\",\"generation\":1}"))
                .andExpect(status().isOk()).andReturn();
        String secret=objectMapper.readTree(issued.getResponse().getContentAsString()).path("secret").asText();
        org.assertj.core.api.Assertions.assertThat(relayGrantRepository.findByUserIdAndDeviceIdAndRevokedAtIsNull(userRepository.findByGithubId("551").orElseThrow().getId(),device).get(0).getTokenHash()).isNotEqualTo(secret).hasSize(64);
        mockMvc.perform(get("/api/settings").header("Authorization","Bearer "+secret)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/relay/captures").header("Authorization","Bearer "+secret).contentType("application/json").content("{\"captureId\":\"bad\"}"))
                .andExpect(status().isBadRequest());
        String huge="x".repeat(1_000_001); String body=capture(UUID.randomUUID().toString(),huge);
        mockMvc.perform(post("/api/relay/captures").header("Authorization","Bearer "+secret).contentType("application/json").content(body)).andExpect(status().isBadRequest());
    }

    @Test
    void settingsAreVersionedValidatedAndForceGithubAutomationOffWithoutTarget() throws Exception {
        githubAccountService.upsert(principal("601", "settings", "Settings", null));
        mockMvc.perform(get("/api/settings").with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version", is(0)))
                .andExpect(jsonPath("$.nickname", is("settings")))
                .andExpect(jsonPath("$.downloadFilenameTemplate", is("Solution_{number}_{name}")))
                .andExpect(jsonPath("$.githubHeader", is(false)))
                .andExpect(jsonPath("$.githubAutoCommitEnabled", is(false)));
        String valid = settingsJson(0, "홍길동", "별명", "{platform}-{number}", "archive/{language}/{number}/{time}", "one-light", "dracula", true, true, null, null, null, null, null)
                .replace("\"githubHeader\":false", "\"githubHeader\":true,\"copyHeaderFields\":[\"title\",\"solvedAt\"],\"downloadHeaderFields\":[\"language\"],\"githubHeaderFields\":[\"identity\",\"url\"]");
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json").content(valid))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name", is("홍길동"))).andExpect(jsonPath("$.nickname", is("별명")))
                .andExpect(jsonPath("$.copyHeaderFields[0]", is("title")))
                .andExpect(jsonPath("$.downloadHeaderFields[0]", is("language")))
                .andExpect(jsonPath("$.githubHeaderFields[1]", is("url")))
                .andExpect(jsonPath("$.githubHeader", is(true)))
                .andExpect(jsonPath("$.githubAutoCommitEnabled", is(false)));
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json").content(valid))
                .andExpect(status().isConflict());
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json")
                        .content(settingsJson(1,"n","n","bad/name","../escape","not-a-theme","dracula",false,false,null,null,null,null,null)))
                .andExpect(status().isBadRequest());
        String invalidFields = settingsJson(1,"n","n","{number}","archive/{number}/{time}","one-light","dracula",false,false,null,null,null,null,null)
                .replace("\"githubHeader\":false", "\"githubHeader\":false,\"githubHeaderFields\":[\"sourceCode\"]");
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json").content(invalidFields))
                .andExpect(status().isBadRequest());
    }

    @Test
    void settingsAllowNullProfileButRejectUnsafeTargetConfiguration() throws Exception {
        githubAccountService.upsert(principal("602", "optional-profile", "Optional", null));
        mockMvc.perform(get("/api/settings").with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602")).andExpect(status().isOk());
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602").contentType("application/json")
                        .content(settingsJson(0,null,null,"{number}","archive/{number}/{capture_ID}","github-light","github-dark",false,false,null,null,null,null,null)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").doesNotExist()).andExpect(jsonPath("$.nickname", is("optional-profile")));
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602").contentType("application/json")
                        .content(settingsJson(1,null,null,"CON","../escape","github-light","github-dark",false,false,-1L,"x".repeat(101),"repo","main","C:/bad")))
                .andExpect(status().isBadRequest());
        // A syntactically valid target is never trusted from owner/repository text.
        // With no configured GitHub App, verification fails closed before any save.
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602").contentType("application/json")
                        .content(settingsJson(1,null,null,"{number}","archive/{number}/{capture_ID}","github-light","github-dark",false,false,7L,"another-owner","repo","main",null)))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void disablingAutomationWithAnUnchangedTargetRevokesRelayDuringProviderOutage() throws Exception {
        githubAccountService.upsert(principal("603", "withdraw-consent", "Withdraw", null));
        AppUser user = userRepository.findByGithubId("603").orElseThrow();
        mockMvc.perform(get("/api/settings").with(githubLogin("603", "withdraw-consent", "Withdraw", null))
                        .header("X-CodeArchive-Github-Id", "603"))
                .andExpect(status().isOk());
        var persisted = userSettingsRepository.findByUserId(user.getId()).orElseThrow();
        persisted.apply(new com.codearchive.api.settings.SettingsRequest(0, "Withdraw", null, false, false, false,
                "{number}", "archive/{number}/{capture_ID}", "Add {platform} {number} solution", "github-light", "github-dark", true, true,
                7L, "owner", "repo", "main", "archive"));
        persisted = userSettingsRepository.saveAndFlush(persisted);
        org.assertj.core.api.Assertions.assertThat(persisted.isAutoSyncEnabled()).isTrue();
        org.assertj.core.api.Assertions.assertThat(persisted.isGithubAutoCommitEnabled()).isTrue();
        String device = "dashboardrelay0603";
        mockMvc.perform(post("/api/relay/grants").with(csrf().asHeader()).with(githubLogin("603", "withdraw-consent", "Withdraw", null))
                        .header("X-CodeArchive-Github-Id", "603").contentType("application/json")
                        .content("{\"deviceId\":\"" + device + "\",\"generation\":" + persisted.getVersion() + "}"))
                .andExpect(status().isOk());
        org.assertj.core.api.Assertions.assertThat(relayGrantRepository.findByUserIdAndDeviceIdAndRevokedAtIsNull(user.getId(), device)).hasSize(1);

        // The GitHub App is intentionally unconfigured in this integration
        // profile. Withdrawal with an unchanged target must still succeed.
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("603", "withdraw-consent", "Withdraw", null))
                        .header("X-CodeArchive-Github-Id", "603").contentType("application/json")
                        .content(settingsJson(persisted.getVersion(), "Withdraw", null, "{number}", "archive/{number}/{capture_ID}", "github-light", "github-dark", false, false, 7L, "owner", "repo", "main", "archive")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.autoSyncEnabled", is(false)))
                .andExpect(jsonPath("$.githubAutoCommitEnabled", is(false)));
        org.assertj.core.api.Assertions.assertThat(relayGrantRepository.findByUserIdAndDeviceIdAndRevokedAtIsNull(user.getId(), device)).isEmpty();
    }

    @Test
    void githubTargetBrowseRequiresGithubAuthentication() throws Exception {
        mockMvc.perform(get("/api/github/targets/installations"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void githubFileAdditionRequiresCsrfAndFailsClosedWhenProviderIsUnavailable() throws Exception {
        githubAccountService.upsert(principal("805", "file-user", "File", null));
        String payload = "{\"branch\":\"main\",\"path\":\"new.txt\",\"content\":\"secret source\",\"message\":\"Add file\",\"expectedHeadSha\":\"" + "a".repeat(40) + "\",\"placeholder\":false}";
        mockMvc.perform(post("/api/github/targets/installations/44/repositories/7/files")
                        .with(githubLogin("805", "file-user", "File", null))
                        .header("X-CodeArchive-Github-Id", "805").contentType("application/json").content(payload))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/github/targets/installations/44/repositories/7/files").with(csrf().asHeader())
                        .with(githubLogin("805", "file-user", "File", null))
                        .header("X-CodeArchive-Github-Id", "805").contentType("application/json").content(payload))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.message", is("GitHub App provider is unavailable")));
    }

    @Test
    void githubInstallationStartIsCsrfProtectedAndFailsClosedWhenProviderIsUnavailable() throws Exception {
        githubAccountService.upsert(principal("804", "install-user", "Install", null));
        mockMvc.perform(post("/api/github/installations/start")
                        .with(githubLogin("804", "install-user", "Install", null))
                        .header("X-CodeArchive-Github-Id", "804"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/github/installations/start").with(csrf().asHeader())
                        .with(githubLogin("804", "install-user", "Install", null))
                        .header("X-CodeArchive-Github-Id", "804"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.message", is("GitHub App provider is unavailable")));
    }

    @Test
    void githubInstallationCallbackReturnsAnExpiredLoginToTheDashboard() throws Exception {
        mockMvc.perform(get("/api/github/installations/callback")
                        .param("state", "opaque-state")
                        .param("installation_id", "44"))
                .andExpect(status().isFound())
                .andExpect(header().string("Location",
                        "http://localhost:5173/?githubInstall=authentication_required"));
    }

    @Test
    void dashboardCorsPreflightAllowsImmutableGithubAccountAssertion() throws Exception {
        mockMvc.perform(options("/api/settings")
                        .header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "PUT")
                        .header("Access-Control-Request-Headers", "X-CodeArchive-Github-Id, X-XSRF-TOKEN"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
                .andExpect(header().string("Access-Control-Allow-Methods", Matchers.containsString("PUT")))
                .andExpect(header().string("Access-Control-Allow-Headers", Matchers.containsString("X-CodeArchive-Github-Id")));
    }

    @Test
    void pinnedExtensionCorsPreflightAllowsBearerRelay() throws Exception {
        String extensionOrigin = "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl";
        mockMvc.perform(options("/api/relay/captures")
                        .header("Origin", extensionOrigin)
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "Authorization, Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", extensionOrigin))
                .andExpect(header().string("Access-Control-Allow-Methods", Matchers.containsString("POST")))
                .andExpect(header().string("Access-Control-Allow-Headers", Matchers.containsString("Authorization")));
    }

    @Test
    void unknownExtensionCorsPreflightCannotUseBearerRelay() throws Exception {
        mockMvc.perform(options("/api/relay/captures")
                        .header("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "Authorization, Content-Type"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void dashboardExpectedGithubIdFailsClosedBeforeSettingsMutation() throws Exception {
        githubAccountService.upsert(principal("801", "account-a", "A", null));
        githubAccountService.upsert(principal("802", "account-b", "B", null));
        String draft = settingsJson(0, "B", "b", "{number}", "archive/{number}/{capture_ID}", "github-light", "github-dark", false, false, null, null, null, null, null);

        mockMvc.perform(get("/api/settings").with(githubLogin("802", "account-b", "B", null)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/settings").with(githubLogin("802", "account-b", "B", null)).header("X-CodeArchive-Github-Id", "801"))
                .andExpect(status().isConflict());
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("802", "account-b", "B", null))
                        .header("X-CodeArchive-Github-Id", "801").contentType("application/json").content(draft))
                .andExpect(status().isConflict());
        org.assertj.core.api.Assertions.assertThat(userSettingsRepository.findByUserId(userRepository.findByGithubId("802").orElseThrow().getId())).isEmpty();
        mockMvc.perform(get("/api/settings").with(githubLogin("802", "account-b", "B", null)).header("X-CodeArchive-Github-Id", "802"))
                .andExpect(status().isOk());
    }

    @Test
    void memoryMeasurementsAreExplicitAndLegacyNumbersRemainUnknown() throws Exception {
        githubAccountService.upsert(principal("701", "memory", "Memory", null));
        String idOne=UUID.randomUUID().toString(), idTwo=UUID.randomUUID().toString(), idThree=UUID.randomUUID().toString(), idFour=UUID.randomUUID().toString(), idFive=UUID.randomUUID().toString();
        String kb=capture(idOne,"kb").replace("\"memoryUsage\":64", "\"memoryUsage\":64,\"memoryValue\":64,\"memoryUnit\":\"KB\"");
        String legacy=capture(idTwo,"legacy");
        String noUnit=capture(idThree,"no-unit").replace("\"memoryUsage\":64", "\"memoryUsage\":64,\"memoryValue\":64");
        String kib=capture(idFour,"kib").replace("\"memoryUsage\":64", "\"memoryUsage\":64,\"memoryValue\":64,\"memoryUnit\":\"kIb\"");
        String mib=capture(idFive,"mib").replace("\"memoryUsage\":64", "\"memoryUsage\":64,\"memoryValue\":64,\"memoryUnit\":\"mIb\"");
        mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader()).with(githubLogin("701","memory","Memory",null)).contentType("application/json").content("{\"captures\":["+kb+","+legacy+","+noUnit+","+kib+","+mib+"]}"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/solutions").with(githubLogin("701","memory","Memory",null)))
                .andExpect(status().isOk()).andExpect(jsonPath("$[?(@.captureId=='"+idOne+"')].memoryValue", Matchers.hasItem(64.0)))
                .andExpect(jsonPath("$[?(@.captureId=='"+idOne+"')].memoryUnit", Matchers.hasItem("KB")))
                .andExpect(jsonPath("$[?(@.captureId=='"+idTwo+"')].memoryUnit", Matchers.hasItem("UNKNOWN")))
                .andExpect(jsonPath("$[?(@.captureId=='"+idThree+"')].memoryUnit", Matchers.hasItem("UNKNOWN")))
                .andExpect(jsonPath("$[?(@.captureId=='"+idFour+"')].memoryUnit", Matchers.hasItem("KiB")))
                .andExpect(jsonPath("$[?(@.captureId=='"+idFive+"')].memoryUnit", Matchers.hasItem("MiB")));
    }

    @Test
    void oauthCallbackWithInvalidStateIsRejectedByTheRealFilter() throws Exception {
        mockMvc.perform(get("/api/login/oauth2/code/github")
                        .param("code", "untrusted")
                        .param("state", "invalid"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("http://localhost:5173/?authError=github"));
    }

    private RequestPostProcessor githubLogin(String id, String login, String name, String email) {
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("id", id);
        attributes.put("login", login);
        attributes.put("avatar_url", "https://avatars.githubusercontent.com/u/" + id + "?v=4");
        if (name != null) {
            attributes.put("name", name);
        }
        if (email != null) {
            attributes.put("email", email);
        }
        return oauth2Login()
                .clientRegistration(githubRegistration())
                .oauth2User(new GithubOAuth2User(
                        java.util.List.of(new SimpleGrantedAuthority("ROLE_USER")),
                        attributes,
                        new GithubIdentity(id, login, name, email)));
    }


    @Test
    void reconciliationPagesAreBoundedPrivateAndAccountPinned() throws Exception {
        AppUser owner = githubAccountService.upsert(principal("921", "reconcile-owner", "Owner", null));
        AppUser other = githubAccountService.upsert(principal("922", "reconcile-other", "Other", null));
        for (int i = 0; i < 53; i++) {
            AppUser account = i == 52 ? other : owner;
            solutionRepository.saveAndFlush(new com.codearchive.api.solution.Solution(account, UUID.randomUUID().toString(),
                    com.codearchive.api.solution.Platform.SWEA, "1234", "Test", "https://swexpertacademy.com/problem/1234",
                    "JAVA", "java", "private source", "ACCEPTED", java.time.Instant.parse("2026-01-02T03:04:05Z"),
                    java.time.Instant.parse("2026-01-02T03:04:05Z"), null, null));
        }
        var first = mockMvc.perform(get("/api/solutions/reconciliation-records?platform=SWEA&cursor=0")
                        .with(githubLogin("921", "reconcile-owner", "Owner", null)).header("X-CodeArchive-Account", "921"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.records", hasSize(50)))
                .andExpect(jsonPath("$.hasMore", is(true))).andExpect(jsonPath("$.records[0].sourceCode").doesNotExist())
                .andExpect(jsonPath("$.records[0].sourceDigest").isString()).andReturn();
        var firstJson = objectMapper.readTree(first.getResponse().getContentAsString());
        org.assertj.core.api.Assertions.assertThat(first.getResponse().getContentAsString()).doesNotContain("private source");
        mockMvc.perform(get("/api/solutions/reconciliation-records?platform=SWEA&cursor=" + firstJson.get("cursor").asLong())
                        .with(githubLogin("921", "reconcile-owner", "Owner", null)).header("X-CodeArchive-Account", "921"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.records", hasSize(2))).andExpect(jsonPath("$.hasMore", is(false)));
        mockMvc.perform(get("/api/solutions/reconciliation-records?platform=SWEA")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/solutions/reconciliation-records?platform=SWEA")
                        .with(githubLogin("921", "reconcile-owner", "Owner", null)).header("X-CodeArchive-Account", "922"))
                .andExpect(status().isConflict());
    }

    @Test
    void enrichmentPreservesKnownMetadataAndRejectsCoreMismatch() throws Exception {
        AppUser owner = githubAccountService.upsert(principal("923", "enrich-owner", "Owner", null));
        var payload = (com.fasterxml.jackson.databind.node.ObjectNode) objectMapper.readTree(capture(UUID.randomUUID().toString(), "class Main {}"));
        payload.put("problemUrl", "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=OwnProblem");
        payload.put("historicalImport", true); payload.put("historicalSubmissionId", "OwnSubmission");
        uploadFixture("923", "enrich-owner", payload).andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)));
        payload.put("metadataPending", true); payload.put("executionTime", 999); payload.put("memoryUsage", 999);
        payload.set("difficulty", objectMapper.createObjectNode().put("label", "D3").put("problemNumber", "1234").put("sourceUrl", payload.get("problemUrl").asText()));
        uploadFixture("923", "enrich-owner", payload).andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)));
        var saved = solutionRepository.findByUserIdOrderBySolvedAtDesc(owner.getId()).get(0);
        org.assertj.core.api.Assertions.assertThat(saved.getExecutionTime()).isEqualByComparingTo("1.25");
        org.assertj.core.api.Assertions.assertThat(saved.getMemoryUsage()).isEqualByComparingTo("64");
        org.assertj.core.api.Assertions.assertThat(saved.getDifficulty().label()).isEqualTo("D3");
        payload.put("captureId", UUID.randomUUID().toString());
        uploadFixture("923", "enrich-owner", payload).andExpect(jsonPath("$.acceptedCaptureIds", hasSize(1)));
        payload.put("solvedAt", "2026-01-02T03:04:06Z");
        uploadFixture("923", "enrich-owner", payload).andExpect(jsonPath("$.acceptedCaptureIds", hasSize(0)));
        payload.put("sourceCode", "class Wrong {}");
        uploadFixture("923", "enrich-owner", payload).andExpect(jsonPath("$.acceptedCaptureIds", hasSize(0)));
        org.assertj.core.api.Assertions.assertThat(solutionRepository.findByUserIdOrderBySolvedAtDesc(owner.getId())).hasSize(1);
    }

    private org.springframework.test.web.servlet.ResultActions uploadFixture(String id, String login, com.fasterxml.jackson.databind.node.ObjectNode payload) throws Exception {
        return mockMvc.perform(post("/api/solutions/bulk").with(csrf().asHeader()).with(githubLogin(id, login, "Owner", null))
                .contentType("application/json").content(objectMapper.createObjectNode().set("captures", objectMapper.createArrayNode().add(payload)).toString()))
                .andExpect(status().isOk());
    }

    private OAuth2User principal(String id, String login, String name, String email) {
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("id", id);
        attributes.put("login", login);
        attributes.put("avatar_url", "https://avatars.githubusercontent.com/u/" + id + "?v=4");
        if (name != null) {
            attributes.put("name", name);
        }
        if (email != null) {
            attributes.put("email", email);
        }
        return new DefaultOAuth2User(
                java.util.List.of(new SimpleGrantedAuthority("ROLE_USER")), attributes, "id");
    }

    private ClientRegistration githubRegistration() {
        return ClientRegistration.withRegistrationId("github")
                .clientId("test-client")
                .clientSecret("test-secret")
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("http://localhost:5173/api/login/oauth2/code/github")
                .scope("read:user")
                .authorizationUri("https://github.com/login/oauth/authorize")
                .tokenUri("https://github.com/login/oauth/access_token")
                .userInfoUri("https://api.github.com/user")
                .userNameAttributeName("id")
                .clientName("GitHub")
                .build();
    }

    private String capture(String captureId, String sourceCode) throws Exception {
        return objectMapper.writeValueAsString(new java.util.LinkedHashMap<String, Object>() {{
            put("captureId", captureId);
            put("platform", "SWEA");
            put("problemNumber", "1234");
            put("title", "Test problem");
            put("problemUrl", "https://swexpertacademy.com/problem/1234");
            put("language", "JAVA");
            put("sourceCode", sourceCode);
            put("result", "ACCEPTED");
            put("observedAt", "2026-01-02T03:04:05Z");
            put("solvedAt", "2026-01-02T03:04:05Z");
            put("executionTime", 1.25);
            put("memoryUsage", 64);
        }});
    }

    private String settingsJson(long version, String name, String nickname, String filename, String git, String light, String dark, boolean auto, boolean githubAuto, Long installation, String owner, String repo, String branch, String root) throws Exception {
        Map<String,Object> value=new HashMap<>(); value.put("version",version); value.put("name",name); value.put("nickname",nickname); value.put("copyHeader",true); value.put("downloadHeader",true); value.put("githubHeader",false); value.put("downloadFilenameTemplate",filename); value.put("gitPathTemplate",git); value.put("githubCommitMessageTemplate","Add {platform} {number} solution"); value.put("lightTheme",light); value.put("darkTheme",dark); value.put("autoSyncEnabled",auto); value.put("githubAutoCommitEnabled",githubAuto); value.put("githubInstallationId",installation); value.put("githubOwner",owner); value.put("githubRepository",repo); value.put("githubBranch",branch); value.put("githubRootPath",root); return objectMapper.writeValueAsString(value);
    }
    private void enableRelay(String id,String login,String name) throws Exception { mockMvc.perform(get("/api/settings").with(githubLogin(id,login,name,null)).header("X-CodeArchive-Github-Id", id)).andExpect(status().isOk()); mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin(id,login,name,null)).header("X-CodeArchive-Github-Id", id).contentType("application/json").content(settingsJson(0,"n","n","{number}","{number}/{capture_ID}","github-light","github-dark",true,false,null,null,null,null,null))).andExpect(status().isOk()); }

    private Cookie persistedGithubSession(String id, String login, String name, String email) {
        Session session = (Session) sessionRepository.createSession();
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("id", id);
        attributes.put("login", login);
        if (name != null) attributes.put("name", name);
        if (email != null) attributes.put("email", email);
        var authorities = java.util.List.of(new SimpleGrantedAuthority("ROLE_USER"));
        GithubOAuth2User user = new GithubOAuth2User(authorities, attributes,
                new GithubIdentity(id, login, name, email));
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new OAuth2AuthenticationToken(user, authorities, "github"));
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        sessionRepository.save(session);
        return new Cookie("JSESSIONID", Base64.getUrlEncoder().withoutPadding()
                .encodeToString(session.getId().getBytes(StandardCharsets.UTF_8)));
    }
}
