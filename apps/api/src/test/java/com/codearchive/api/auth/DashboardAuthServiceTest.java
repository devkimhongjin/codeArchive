package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.auth.oauth.AuthExchangeCode;
import com.codearchive.api.auth.oauth.AuthExchangeCodeRepository;
import com.codearchive.api.auth.oauth.GitHubProviderClient;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.oauth.OAuthState;
import com.codearchive.api.auth.oauth.OAuthStateRepository;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSession;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserService;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@ExtendWith(MockitoExtension.class)
class DashboardAuthServiceTest {

    private static final Instant NOW =
            Instant.parse("2026-08-28T06:30:00Z");
    private static final String DASHBOARD_ORIGIN =
            "https://codearchive-dashboard-beta.onrender.com";

    @Mock
    private GitHubProviderClient githubProviderClient;
    @Mock
    private OAuthStateRepository oauthStateRepository;
    @Mock
    private AuthExchangeCodeRepository exchangeCodeRepository;
    @Mock
    private AuthSessionRepository authSessionRepository;
    @Mock
    private UserService userService;
    @Mock
    private SecureTokenCodec tokenCodec;

    private AuthProperties authProperties;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        authProperties = new AuthProperties();
        authProperties.getGithub().setClientId("synthetic-client");
        authProperties.getGithub().setClientSecret("synthetic-secret");
        authProperties.getGithub().setCallbackUrl(
                "https://codearchive-api.onrender.com/api/v1/auth/github/callback"
        );
        authProperties.setDashboardOrigin(DASHBOARD_ORIGIN);
        authProperties.setStateTtl(Duration.ofMinutes(10));
        authProperties.setSessionTtl(Duration.ofDays(30));

        authService = new AuthService(
                authProperties,
                githubProviderClient,
                oauthStateRepository,
                exchangeCodeRepository,
                authSessionRepository,
                userService,
                tokenCodec,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void dashboardLoginStoresHashAndMarksDashboardFlow() {
        when(tokenCodec.generate())
                .thenReturn("synthetic-raw-state");
        when(tokenCodec.hash("synthetic-raw-state"))
                .thenReturn("synthetic-state-hash");

        AuthService.DashboardLoginStart result =
                authService.beginGitHubDashboardLogin();

        ArgumentCaptor<OAuthState> stateCaptor =
                ArgumentCaptor.forClass(OAuthState.class);
        verify(oauthStateRepository).save(
                stateCaptor.capture()
        );

        assertThat(stateCaptor.getValue().getStateHash())
                .isEqualTo("synthetic-state-hash")
                .isNotEqualTo("synthetic-raw-state");
        assertThat(stateCaptor.getValue().getFlowType())
                .isEqualTo(OAuthState.FlowType.DASHBOARD);
        assertThat(result.rawState())
                .isEqualTo("synthetic-raw-state");
        assertThat(result.authorizationUrl())
                .contains("prompt=select_account");
        assertThat(result.expiresAt())
                .isEqualTo(NOW.plus(Duration.ofMinutes(10)));
    }

    @Test
    void dashboardCallbackRequiresMatchingPreAuthCookie() {
        OAuthState state = OAuthState.create(
                "synthetic-state-hash",
                OAuthState.FlowType.DASHBOARD,
                NOW.plusSeconds(60),
                NOW
        );
        when(tokenCodec.hash("synthetic-callback-state"))
                .thenReturn("synthetic-state-hash");
        when(oauthStateRepository.findByStateHash(
                "synthetic-state-hash"
        )).thenReturn(java.util.Optional.of(state));

        assertThatThrownBy(() ->
                authService.completeGitHubCallback(
                        "synthetic-code",
                        "synthetic-callback-state",
                        null
                )
        ).isInstanceOfSatisfying(
                CodeArchiveException.class,
                exception -> assertThat(
                        exception.getErrorCode()
                ).isEqualTo(ErrorCode.AUTH_FLOW_INVALID)
        );

        when(tokenCodec.hash("synthetic-wrong-cookie"))
                .thenReturn("synthetic-other-hash");

        assertThatThrownBy(() ->
                authService.completeGitHubCallback(
                        "synthetic-code",
                        "synthetic-callback-state",
                        "synthetic-wrong-cookie"
                )
        ).isInstanceOfSatisfying(
                CodeArchiveException.class,
                exception -> assertThat(
                        exception.getErrorCode()
                ).isEqualTo(ErrorCode.AUTH_FLOW_INVALID)
        );

        verify(oauthStateRepository, never())
                .consumeActive(any(), any());
        verify(githubProviderClient, never())
                .fetchUser(any());
    }

    @Test
    void dashboardCallbackCreatesSessionWithoutExchangeCode() {
        OAuthState state = OAuthState.create(
                "synthetic-state-hash",
                OAuthState.FlowType.DASHBOARD,
                NOW.plusSeconds(60),
                NOW
        );
        GitHubUserProfile profile = new GitHubUserProfile(
                1001L,
                "synthetic-user",
                "Synthetic User",
                null
        );
        CodeArchiveUser user =
                CodeArchiveUser.create(profile, NOW);

        when(tokenCodec.hash("synthetic-state"))
                .thenReturn("synthetic-state-hash");
        when(oauthStateRepository.findByStateHash(
                "synthetic-state-hash"
        )).thenReturn(java.util.Optional.of(state));
        when(oauthStateRepository.consumeActive(
                "synthetic-state-hash",
                NOW
        )).thenReturn(1);
        when(githubProviderClient.fetchUser(
                "synthetic-code"
        )).thenReturn(profile);
        when(userService.upsert(profile)).thenReturn(user);
        when(tokenCodec.generate())
                .thenReturn("synthetic-session-token");
        when(tokenCodec.hash("synthetic-session-token"))
                .thenReturn("synthetic-session-hash");

        AuthService.CallbackExchange result =
                authService.completeGitHubCallback(
                        "synthetic-code",
                        "synthetic-state",
                        "synthetic-state"
                );

        ArgumentCaptor<AuthSession> sessionCaptor =
                ArgumentCaptor.forClass(AuthSession.class);
        verify(authSessionRepository).save(
                sessionCaptor.capture()
        );
        verify(exchangeCodeRepository, never()).save(
                any(AuthExchangeCode.class)
        );

        assertThat(result.exchangeCode()).isNull();
        assertThat(result.dashboardSession()).isNotNull();
        assertThat(result.dashboardSession().accessToken())
                .isEqualTo("synthetic-session-token");
        assertThat(result.completionRedirectUri())
                .isEqualTo(DASHBOARD_ORIGIN + "/");
        assertThat(sessionCaptor.getValue().getTokenHash())
                .isEqualTo("synthetic-session-hash")
                .isNotEqualTo("synthetic-session-token");
    }

    @Test
    void dashboardCallbackRejectsExpiredOrReplayedState() {
        OAuthState state = OAuthState.create(
                "synthetic-state-hash",
                OAuthState.FlowType.DASHBOARD,
                NOW.minusSeconds(1),
                NOW.minusSeconds(120)
        );

        when(tokenCodec.hash("synthetic-state"))
                .thenReturn("synthetic-state-hash");
        when(oauthStateRepository.findByStateHash(
                "synthetic-state-hash"
        )).thenReturn(java.util.Optional.of(state));
        when(oauthStateRepository.consumeActive(
                "synthetic-state-hash",
                NOW
        )).thenReturn(0);

        assertThatThrownBy(() ->
                authService.completeGitHubCallback(
                        "synthetic-code",
                        "synthetic-state",
                        "synthetic-state"
                )
        ).isInstanceOfSatisfying(
                CodeArchiveException.class,
                exception -> assertThat(
                        exception.getErrorCode()
                ).isEqualTo(ErrorCode.AUTH_FLOW_INVALID)
        );

        verify(githubProviderClient, never())
                .fetchUser(any());
        verify(authSessionRepository, never())
                .save(any(AuthSession.class));
    }

    @Test
    void dashboardLoginFailsClosedForInvalidOrigin() {
        authProperties.setDashboardOrigin(
                "https://codearchive-dashboard-beta.onrender.com/path"
        );

        assertThatThrownBy(
                authService::beginGitHubDashboardLogin
        ).isInstanceOfSatisfying(
                CodeArchiveException.class,
                exception -> assertThat(
                        exception.getErrorCode()
                ).isEqualTo(
                        ErrorCode.AUTH_PROVIDER_UNAVAILABLE
                )
        );

        verify(oauthStateRepository, never())
                .save(any(OAuthState.class));
    }
}
