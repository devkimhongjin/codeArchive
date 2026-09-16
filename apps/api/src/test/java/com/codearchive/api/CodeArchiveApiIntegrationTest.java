package com.codearchive.api;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
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
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
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
    GithubAccountService githubAccountService;

    @Autowired
    ObjectMapper objectMapper;

    @BeforeEach
    void clearUsers() {
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
                .andExpect(jsonPath("$.email", is("new@example.com")));
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
        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(get("/api/auth/me").session(session)
                        .with(githubLogin("1003", "logout-user", "Logout", null)))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/logout").session(session).with(csrf().asHeader()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isUnauthorized());
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
                .andExpect(jsonPath("$[0].sourceCode", is("first source")));

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
}
