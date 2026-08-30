package com.codearchive.api.auth;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.codearchive.api.auth.config.SecurityConfig;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.common.filter.RequestIdFilter;

import jakarta.servlet.http.Cookie;

@WebMvcTest(
        controllers = {
                AuthController.class,
                MeController.class
        }
)
@Import(SecurityConfig.class)
@TestPropertySource(properties = {
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"
})
class DashboardAuthSecurityMockMvcTest {

    private static final String REQUEST_ID =
            "dashboard-auth-security-test";
    private static final String DASHBOARD_ORIGIN =
            "https://codearchive-dashboard-beta.onrender.com";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AuthService authService;

    @Test
    void dashboardLoginRedirectsWithoutJsonAndSetsPreAuthCookie()
            throws Exception {
        when(authService.beginGitHubDashboardLogin())
                .thenReturn(
                        new AuthService.DashboardLoginStart(
                                "https://github.test/login/oauth/authorize?synthetic=true",
                                "synthetic-pre-auth-state",
                                Instant.parse(
                                        "2026-08-28T07:00:00Z"
                                )
                        )
                );
        when(authService.oauthStateTtl())
                .thenReturn(Duration.ofMinutes(10));

        mockMvc.perform(
                        get("/api/v1/auth/github/dashboard-login")
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isFound())
                .andExpect(header().string(
                        HttpHeaders.LOCATION,
                        "https://github.test/login/oauth/authorize?synthetic=true"
                ))
                .andExpect(header().string(
                        HttpHeaders.CACHE_CONTROL,
                        Matchers.containsString("no-store")
                ))
                .andExpect(header().string(
                        HttpHeaders.SET_COOKIE,
                        Matchers.allOf(
                                Matchers.containsString(
                                        "__Secure-codearchive_oauth_state=synthetic-pre-auth-state"
                                ),
                                Matchers.containsString("Path=/api/v1/auth/github"),
                                Matchers.containsString("Max-Age=600"),
                                Matchers.containsString("Secure"),
                                Matchers.containsString("HttpOnly"),
                                Matchers.containsString("SameSite=Lax"),
                                Matchers.not(Matchers.containsString("Domain="))
                        )
                ))
                .andExpect(content().string(""));
    }

    @Test
    void dashboardCallbackSetsHostSessionAndRedirectsExactly()
            throws Exception {
        Instant expiresAt =
                Instant.parse("2026-09-27T06:30:00Z");
        AuthService.IssuedSession issuedSession =
                new AuthService.IssuedSession(
                        "synthetic-session-token",
                        expiresAt
                );

        when(authService.completeGitHubCallback(
                "synthetic-code",
                "synthetic-state",
                "synthetic-state"
        )).thenReturn(
                new AuthService.CallbackExchange(
                        null,
                        expiresAt,
                        DASHBOARD_ORIGIN + "/",
                        issuedSession
                )
        );
        when(authService.sessionTtl())
                .thenReturn(Duration.ofDays(30));

        mockMvc.perform(
                        get("/api/v1/auth/github/callback")
                                .queryParam(
                                        "code",
                                        "synthetic-code"
                                )
                                .queryParam(
                                        "state",
                                        "synthetic-state"
                                )
                                .cookie(
                                        new Cookie(
                                                AuthController.OAUTH_STATE_COOKIE_NAME,
                                                "synthetic-state"
                                        )
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isSeeOther())
                .andExpect(header().string(
                        HttpHeaders.LOCATION,
                        DASHBOARD_ORIGIN + "/"
                ))
                .andExpect(header().string(
                        HttpHeaders.CACHE_CONTROL,
                        Matchers.containsString("no-store")
                ))
                .andExpect(header().string(
                        "Referrer-Policy",
                        "no-referrer"
                ))
                .andExpect(header().stringValues(
                        HttpHeaders.SET_COOKIE,
                        Matchers.hasItems(
                                Matchers.allOf(
                                        Matchers.containsString(
                                                "__Host-codearchive_session=synthetic-session-token"
                                        ),
                                        Matchers.containsString("Path=/"),
                                        Matchers.containsString(
                                                "Max-Age=2592000"
                                        ),
                                        Matchers.containsString("Secure"),
                                        Matchers.containsString("HttpOnly"),
                                        Matchers.containsString(
                                                "SameSite=None"
                                        ),
                                        Matchers.not(Matchers.containsString("Domain="))
                                ),
                                Matchers.allOf(
                                        Matchers.containsString(
                                                "__Secure-codearchive_oauth_state="
                                        ),
                                        Matchers.containsString(
                                                "Path=/api/v1/auth/github"
                                        ),
                                        Matchers.containsString(
                                                "Max-Age=0"
                                        ),
                                        Matchers.containsString("Secure"),
                                        Matchers.containsString("HttpOnly"),
                                        Matchers.containsString(
                                                "SameSite=Lax"
                                        ),
                                        Matchers.not(Matchers.containsString("Domain="))
                                )
                        )
                ))
                .andExpect(content().string(""));
    }

    @Test
    void dashboardSessionCookieAuthenticatesMe()
            throws Exception {
        GitHubUserProfile profile =
                new GitHubUserProfile(
                        1001L,
                        "synthetic-user",
                        "Synthetic User",
                        null
                );
        CodeArchiveUser user =
                CodeArchiveUser.create(
                        profile,
                        Instant.parse(
                                "2026-08-28T06:30:00Z"
                        )
                );
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        user.getId(),
                        UUID.randomUUID(),
                        "synthetic-user"
                );

        when(authService.authenticate(
                "synthetic-session-token"
        )).thenReturn(Optional.of(principal));
        when(authService.currentUser(principal))
                .thenReturn(user);

        mockMvc.perform(
                        get("/api/v1/me")
                                .cookie(
                                        new Cookie(
                                                ApiAuthenticationFilter
                                                        .SESSION_COOKIE_NAME,
                                                "synthetic-session-token"
                                        )
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

    @Test
    void expiredOrRevokedDashboardCookieReturns401()
            throws Exception {
        when(authService.authenticate(
                "synthetic-expired-session"
        )).thenReturn(Optional.empty());

        mockMvc.perform(
                        get("/api/v1/me")
                                .cookie(
                                        new Cookie(
                                                ApiAuthenticationFilter
                                                        .SESSION_COOKIE_NAME,
                                                "synthetic-expired-session"
                                        )
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
                .andExpect(status().isUnauthorized());
    }

    @Test
    void bearerAndCookieTogetherAreRejected()
            throws Exception {
        mockMvc.perform(
                        get("/api/v1/me")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        "Bearer synthetic-bearer"
                                )
                                .cookie(
                                        new Cookie(
                                                ApiAuthenticationFilter
                                                        .SESSION_COOKIE_NAME,
                                                "synthetic-cookie"
                                        )
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
                .andExpect(status().isUnauthorized());

        verify(authService, never()).authenticate(
                org.mockito.ArgumentMatchers.anyString()
        );
    }

    @Test
    void cookieLogoutRequiresExactOriginAndClearsCookie()
            throws Exception {
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "synthetic-user"
                );

        when(authService.authenticate(
                "synthetic-session-token"
        )).thenReturn(Optional.of(principal));

        mockMvc.perform(
                        post("/api/v1/auth/logout")
                                .cookie(
                                        new Cookie(
                                                ApiAuthenticationFilter
                                                        .SESSION_COOKIE_NAME,
                                                "synthetic-session-token"
                                        )
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isForbidden());

        verify(authService, never()).logout(principal);

        mockMvc.perform(
                        post("/api/v1/auth/logout")
                                .header(
                                        HttpHeaders.ORIGIN,
                                        "https://unapproved.example"
                                )
                                .cookie(
                                        new Cookie(
                                                ApiAuthenticationFilter
                                                        .SESSION_COOKIE_NAME,
                                                "synthetic-session-token"
                                        )
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isForbidden());

        mockMvc.perform(
                        post("/api/v1/auth/logout")
                                .header(
                                        HttpHeaders.ORIGIN,
                                        DASHBOARD_ORIGIN
                                )
                                .cookie(
                                        new Cookie(
                                                ApiAuthenticationFilter
                                                        .SESSION_COOKIE_NAME,
                                                "synthetic-session-token"
                                        )
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isOk())
                .andExpect(header().string(
                        HttpHeaders.SET_COOKIE,
                        Matchers.allOf(
                                Matchers.containsString(
                                        "__Host-codearchive_session="
                                ),
                                Matchers.containsString("Path=/"),
                                Matchers.containsString("Max-Age=0"),
                                Matchers.containsString("Secure"),
                                Matchers.containsString("HttpOnly"),
                                Matchers.containsString("SameSite=None"),
                                Matchers.not(Matchers.containsString("Domain="))
                        )
                ));

        verify(authService).logout(principal);
    }

    @Test
    void bearerLogoutIsNotCsrfBlocked()
            throws Exception {
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "synthetic-user"
                );
        when(authService.authenticate("synthetic-bearer"))
                .thenReturn(Optional.of(principal));

        mockMvc.perform(
                        post("/api/v1/auth/logout")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        "Bearer synthetic-bearer"
                                )
                                .requestAttr(
                                        RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                                        REQUEST_ID
                                )
                )
                .andExpect(status().isOk());

        verify(authService).logout(principal);
    }

    @Test
    void dashboardCorsAllowsCredentialsForExactOrigin()
            throws Exception {
        mockMvc.perform(
                        options("/api/v1/auth/logout")
                                .header(
                                        HttpHeaders.ORIGIN,
                                        DASHBOARD_ORIGIN
                                )
                                .header(
                                        HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD,
                                        "POST"
                                )
                                .header(
                                        HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS,
                                        "authorization, content-type"
                                )
                )
                .andExpect(status().isOk())
                .andExpect(header().string(
                        HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN,
                        DASHBOARD_ORIGIN
                ))
                .andExpect(header().string(
                        HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS,
                        "true"
                ))
                .andExpect(header().string(
                        HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS,
                        Matchers.containsString("authorization")
                ))
                .andExpect(header().string(
                        HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS,
                        Matchers.containsString("content-type")
                ));
    }

    @Test
    void unapprovedWebOriginIsRejectedByCors()
            throws Exception {
        mockMvc.perform(
                        options("/api/v1/auth/logout")
                                .header(
                                        HttpHeaders.ORIGIN,
                                        "https://unapproved.example"
                                )
                                .header(
                                        HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD,
                                        "POST"
                                )
                )
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(
                        HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN
                ));
    }
}
