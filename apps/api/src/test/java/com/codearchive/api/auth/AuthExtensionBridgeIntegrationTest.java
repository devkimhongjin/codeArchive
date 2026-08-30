package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.util.UriComponents;
import org.springframework.web.util.UriComponentsBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.auth.oauth.AuthExchangeCodeRepository;
import com.codearchive.api.auth.oauth.GitHubProviderClient;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.oauth.OAuthState;
import com.codearchive.api.auth.oauth.OAuthStateRepository;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(properties = {
        "DB_PASSWORD=test-only",
        "codearchive.auth.github.client-id=mock-client-id",
        "codearchive.auth.github.client-secret=mock-client-secret",
        "codearchive.auth.github.callback-url=https://api.codearchive.test/api/v1/auth/github/callback",
        "codearchive.auth.extension-redirect-uri=https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/codearchive-auth",
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"
})
@AutoConfigureMockMvc
@Testcontainers
class AuthExtensionBridgeIntegrationTest {

    private static final String SERVER_CALLBACK =
            "https://api.codearchive.test/api/v1/auth/github/callback";
    private static final String EXTENSION_REDIRECT =
            "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/codearchive-auth";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private SecureTokenCodec tokenCodec;

    @Autowired
    private OAuthStateRepository oauthStateRepository;

    @Autowired
    private AuthExchangeCodeRepository exchangeCodeRepository;

    @Autowired
    private AuthSessionRepository authSessionRepository;

    @Autowired
    private UserRepository userRepository;

    @MockitoBean
    private GitHubProviderClient githubProviderClient;

    @AfterEach
    void cleanDatabase() {
        authSessionRepository.deleteAllInBatch();
        exchangeCodeRepository.deleteAllInBatch();
        oauthStateRepository.deleteAllInBatch();
        userRepository.deleteAllInBatch();
    }

    @Test
    void flywayV5AppliesOnRealPostgres() {
        Integer applied = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history "
                        + "WHERE version = '5' AND success = true",
                Integer.class
        );
        String flowTypeColumn = jdbcTemplate.queryForObject(
                "SELECT column_name FROM information_schema.columns "
                        + "WHERE table_schema = 'public' "
                        + "AND table_name = 'oauth_states' "
                        + "AND column_name = 'flow_type'",
                String.class
        );

        assertThat(POSTGRES.isRunning()).isTrue();
        assertThat(applied).isEqualTo(1);
        assertThat(flowTypeColumn).isEqualTo("flow_type");
    }

    @Test
    void dashboardLoginPersistsDashboardFlowOnRealPostgres() throws Exception {
        mockMvc.perform(get("/api/v1/auth/github/dashboard-login"))
                .andExpect(status().isFound());

        assertThat(jdbcTemplate.queryForList(
                "SELECT flow_type FROM oauth_states", String.class
        )).containsExactly("DASHBOARD");
        verify(githubProviderClient, never()).fetchUser(anyString());
    }

    @Test
    void extensionCallbackRedirectsExactTargetAndExchangeRemainsSingleUse()
            throws Exception {
        GitHubUserProfile profile = new GitHubUserProfile(
                7007L,
                "bridge-user",
                "Bridge User",
                null
        );
        when(githubProviderClient.fetchUser("github-code"))
                .thenReturn(profile);

        String loginBody = mockMvc.perform(
                        get("/api/v1/auth/github/extension-login")
                )
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode loginJson = objectMapper.readTree(loginBody);
        String authorizationUrl = loginJson
                .path("data")
                .path("authorizationUrl")
                .asText();
        UriComponents authorization = UriComponentsBuilder
                .fromUriString(authorizationUrl)
                .build();
        String rawState = authorization
                .getQueryParams()
                .getFirst("state");

        assertThat(rawState).isNotBlank();
        assertThat(authorization.getQueryParams()
                .getFirst("redirect_uri"))
                .isEqualTo(SERVER_CALLBACK);
        assertThat(authorization.getQueryParams())
                .doesNotContainKey("scope");
        assertThat(authorizationUrl)
                .doesNotContain("chromiumapp.org")
                .doesNotContain("repo");

        OAuthState persistedState = oauthStateRepository
                .findByStateHash(tokenCodec.hash(rawState))
                .orElseThrow();
        assertThat(persistedState.getFlowType())
                .isEqualTo(OAuthState.FlowType.EXTENSION);

        String location = mockMvc.perform(
                        get("/api/v1/auth/github/callback")
                                .queryParam("code", "github-code")
                                .queryParam("state", rawState)
                                .queryParam(
                                        "redirectUri",
                                        "https://evil.example/steal"
                                )
                                .queryParam(
                                        "completionUri",
                                        "https://attacker.chromiumapp.org/other"
                                )
                )
                .andExpect(status().isFound())
                .andReturn()
                .getResponse()
                .getHeader("Location");

        assertThat(location).isNotNull();
        URI redirect = URI.create(location);
        assertThat(
                redirect.getScheme()
                        + "://"
                        + redirect.getHost()
                        + redirect.getPath()
        ).isEqualTo(EXTENSION_REDIRECT);
        assertThat(redirect.getQuery()).isNull();
        assertThat(redirect.getFragment())
                .startsWith("code=");
        assertThat(location)
                .doesNotContain("evil.example")
                .doesNotContain("attacker.chromiumapp.org")
                .doesNotContain("Bearer")
                .doesNotContain("accessToken");

        String exchangeCode = redirect.getFragment()
                .substring("code=".length());
        assertThat(exchangeCode).isNotBlank();

        String exchangeBody = mockMvc.perform(
                        post("/api/v1/auth/exchange")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\""
                                                + exchangeCode
                                                + "\"}"
                                )
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessToken").isString())
                .andReturn()
                .getResponse()
                .getContentAsString();

        String accessToken = objectMapper
                .readTree(exchangeBody)
                .path("data")
                .path("accessToken")
                .asText();
        assertThat(accessToken).isNotBlank();
        assertThat(location).doesNotContain(accessToken);

        mockMvc.perform(
                        post("/api/v1/auth/exchange")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\""
                                                + exchangeCode
                                                + "\"}"
                                )
                )
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.error.code")
                                .value("AUTH_EXCHANGE_INVALID")
                );

        mockMvc.perform(
                        get("/api/v1/auth/github/callback")
                                .queryParam("code", "github-code")
                                .queryParam("state", rawState)
                )
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.error.code")
                                .value("AUTH_FLOW_INVALID")
                );

        verify(githubProviderClient, times(1))
                .fetchUser("github-code");
    }

    @Test
    void malformedStateNeverCallsGitHubProvider() throws Exception {
        mockMvc.perform(
                        get("/api/v1/auth/github/callback")
                                .queryParam("code", "github-code")
                                .queryParam("state", "malformed-state")
                )
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.error.code")
                                .value("AUTH_FLOW_INVALID")
                );

        verify(githubProviderClient, never())
                .fetchUser(anyString());
    }
}
