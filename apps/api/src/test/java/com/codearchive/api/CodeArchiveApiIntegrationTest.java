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
import jakarta.servlet.http.Cookie;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpSession;
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
    @org.springframework.transaction.annotation.Transactional
    void bulkSyncEnqueuesTheSameDurableGithubJobAsRelayDelivery() throws Exception {
        AppUser user = githubAccountService.upsert(principal("304", "manual-recovery", "Manual", null));
        var settings = new com.codearchive.api.settings.UserSettings(user);
        settings.apply(new com.codearchive.api.settings.SettingsRequest(
                0, "Manual", null, false, false,
                "{platform}-{number}-{title}", "{platform}/{number}-{title}",
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
                .andExpect(jsonPath("$.downloadFilenameTemplate", is("Solution_{number}_{name}")))
                .andExpect(jsonPath("$.githubAutoCommitEnabled", is(false)));
        String valid = settingsJson(0, "홍길동", "별명", "{platform}-{number}", "archive/{language}/{number}", "one-light", "dracula", true, true, null, null, null, null, null);
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json").content(valid))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name", is("홍길동"))).andExpect(jsonPath("$.nickname", is("별명")))
                .andExpect(jsonPath("$.githubAutoCommitEnabled", is(false)));
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json").content(valid))
                .andExpect(status().isConflict());
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("601", "settings", "Settings", null)).header("X-CodeArchive-Github-Id", "601").contentType("application/json")
                        .content(settingsJson(1,"n","n","bad/name","../escape","not-a-theme","dracula",false,false,null,null,null,null,null)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void settingsAllowNullProfileButRejectUnsafeTargetConfiguration() throws Exception {
        githubAccountService.upsert(principal("602", "optional-profile", "Optional", null));
        mockMvc.perform(get("/api/settings").with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602")).andExpect(status().isOk());
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602").contentType("application/json")
                        .content(settingsJson(0,null,null,"{number}","archive/{number}","github-light","github-dark",false,false,null,null,null,null,null)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").doesNotExist()).andExpect(jsonPath("$.nickname").doesNotExist());
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602").contentType("application/json")
                        .content(settingsJson(1,null,null,"CON","../escape","github-light","github-dark",false,false,-1L,"x".repeat(101),"repo","main","C:/bad")))
                .andExpect(status().isBadRequest());
        // A syntactically valid target is never trusted from owner/repository text.
        // With no configured GitHub App, verification fails closed before any save.
        mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin("602", "optional-profile", "Optional", null)).header("X-CodeArchive-Github-Id", "602").contentType("application/json")
                        .content(settingsJson(1,null,null,"{number}","archive/{number}","github-light","github-dark",false,false,7L,"another-owner","repo","main",null)))
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
        persisted.apply(new com.codearchive.api.settings.SettingsRequest(0, "Withdraw", null, false, false,
                "{number}", "archive/{number}", "Add {platform} {number} solution", "github-light", "github-dark", true, true,
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
                        .content(settingsJson(persisted.getVersion(), "Withdraw", null, "{number}", "archive/{number}", "github-light", "github-dark", false, false, 7L, "owner", "repo", "main", "archive")))
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
        String draft = settingsJson(0, "B", "b", "{number}", "archive/{number}", "github-light", "github-dark", false, false, null, null, null, null, null);

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
        Map<String,Object> value=new HashMap<>(); value.put("version",version); value.put("name",name); value.put("nickname",nickname); value.put("copyHeader",true); value.put("downloadHeader",true); value.put("downloadFilenameTemplate",filename); value.put("gitPathTemplate",git); value.put("githubCommitMessageTemplate","Add {platform} {number} solution"); value.put("lightTheme",light); value.put("darkTheme",dark); value.put("autoSyncEnabled",auto); value.put("githubAutoCommitEnabled",githubAuto); value.put("githubInstallationId",installation); value.put("githubOwner",owner); value.put("githubRepository",repo); value.put("githubBranch",branch); value.put("githubRootPath",root); return objectMapper.writeValueAsString(value);
    }
    private void enableRelay(String id,String login,String name) throws Exception { mockMvc.perform(get("/api/settings").with(githubLogin(id,login,name,null)).header("X-CodeArchive-Github-Id", id)).andExpect(status().isOk()); mockMvc.perform(put("/api/settings").with(csrf().asHeader()).with(githubLogin(id,login,name,null)).header("X-CodeArchive-Github-Id", id).contentType("application/json").content(settingsJson(0,"n","n","{number}","{number}","github-light","github-dark",true,false,null,null,null,null,null))).andExpect(status().isOk()); }

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
