package com.codearchive.api.auth;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.codearchive.api.auth.config.SecurityConfig;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.common.filter.RequestIdFilter;

@WebMvcTest(
        controllers = {
                MeController.class,
                AuthController.class
        }
)
@Import(SecurityConfig.class)
class SecurityFilterChainMockMvcTest {

    private static final String REQUEST_ID =
            "security-filter-chain-test";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AuthService authService;

    @Test
    void unauthenticatedMeReturns401SafeJson()
            throws Exception {
        mockMvc.perform(
                        get("/api/v1/me")
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                                .header(
                                        RequestIdFilter.REQUEST_ID_HEADER,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isUnauthorized())
                .andExpect(
                        content().contentTypeCompatibleWith(
                                MediaType.APPLICATION_JSON
                        )
                )
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(
                        jsonPath("$.error.code")
                                .value("AUTH_REQUIRED")
                )
                .andExpect(
                        jsonPath("$.requestId")
                                .value(REQUEST_ID)
                );
    }

    @Test
    void invalidBearerMeReturns401()
            throws Exception {
        when(authService.authenticate("invalid-token"))
                .thenReturn(Optional.empty());

        mockMvc.perform(
                        get("/api/v1/me")
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        "Bearer invalid-token"
                                )
                                .header(
                                        RequestIdFilter.REQUEST_ID_HEADER,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.error.code")
                                .value("AUTH_REQUIRED")
                );
    }

    @Test
    void validBearerCanReachMe()
            throws Exception {
        GitHubUserProfile profile =
                new GitHubUserProfile(
                        1001L,
                        "tester",
                        "Tester",
                        "https://example.test/avatar.png"
                );
        CodeArchiveUser user =
                CodeArchiveUser.create(
                        profile,
                        Instant.parse(
                                "2026-08-25T06:45:00Z"
                        )
                );
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        user.getId(),
                        UUID.randomUUID(),
                        "tester"
                );

        when(authService.authenticate("valid-token"))
                .thenReturn(Optional.of(principal));
        when(authService.currentUser(principal))
                .thenReturn(user);

        mockMvc.perform(
                        get("/api/v1/me")
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        "Bearer valid-token"
                                )
                                .header(
                                        RequestIdFilter.REQUEST_ID_HEADER,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(
                        jsonPath("$.data.id")
                                .value(user.getId().toString())
                )
                .andExpect(
                        jsonPath("$.data.githubUserId")
                                .value(1001)
                )
                .andExpect(
                        jsonPath("$.data.githubLogin")
                                .value("tester")
                );
    }

    @Test
    void publicAuthEndpointsAllowMissingBearer()
            throws Exception {
        Instant expiresAt = Instant.parse(
                "2026-08-25T07:00:00Z"
        );

        when(authService.beginGitHubLogin())
                .thenReturn(
                        new AuthService.LoginStart(
                                "https://github.example/authorize",
                                expiresAt
                        )
                );
        when(
                authService.completeGitHubCallback(
                        "provider-code",
                        "oauth-state"
                )
        ).thenReturn(
                new AuthService.CallbackExchange(
                        "exchange-code",
                        expiresAt
                )
        );
        when(authService.exchange("exchange-code"))
                .thenReturn(
                        new AuthService.IssuedSession(
                                "access-token",
                                expiresAt
                        )
                );

        mockMvc.perform(
                        get("/api/v1/auth/github/login")
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                                .header(
                                        RequestIdFilter.REQUEST_ID_HEADER,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isOk());

        mockMvc.perform(
                        get("/api/v1/auth/github/callback")
                                .queryParam(
                                        "code",
                                        "provider-code"
                                )
                                .queryParam(
                                        "state",
                                        "oauth-state"
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                                .header(
                                        RequestIdFilter.REQUEST_ID_HEADER,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isOk());

        mockMvc.perform(
                        post("/api/v1/auth/exchange")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\"exchange-code\"}"
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                                .header(
                                        RequestIdFilter.REQUEST_ID_HEADER,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isOk());
    }
}
