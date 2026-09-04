package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

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
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSession;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserService;
import com.codearchive.api.relay.RelayGrantService;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    private static final Instant NOW =
            Instant.parse("2026-08-25T05:47:00Z");

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

    @Mock
    private RelayGrantService relayGrantService;

    private AuthProperties authProperties;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        authProperties = new AuthProperties();
        authProperties.getGithub().setClientId(
                "mock-client-id"
        );
        authProperties.getGithub().setClientSecret(
                "mock-client-secret"
        );
        authProperties.getGithub().setCallbackUrl(
                "https://codearchive.test/api/v1/auth/github/callback"
        );
        authProperties.setStateTtl(Duration.ofMinutes(10));
        authProperties.setExchangeTtl(Duration.ofMinutes(2));
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
    void loginStoresOnlyStateHashAndRequestsNoRepositoryScope() {
        when(tokenCodec.generate())
                .thenReturn("raw-state");
        when(tokenCodec.hash("raw-state"))
                .thenReturn("state-hash");

        AuthService.LoginStart result =
                authService.beginGitHubLogin();

        ArgumentCaptor<OAuthState> stateCaptor =
                ArgumentCaptor.forClass(OAuthState.class);
        verify(oauthStateRepository)
                .save(stateCaptor.capture());

        assertThat(stateCaptor.getValue().getStateHash())
                .isEqualTo("state-hash")
                .isNotEqualTo("raw-state");
        assertThat(result.authorizationUrl())
                .contains("client_id=mock-client-id")
                .contains("state=raw-state")
                .doesNotContain("prompt=select_account")
                .doesNotContain("scope=")
                .doesNotContain("repo");
    }

    @Test
    void callbackConsumesStateAndReturnsOneTimeExchangeCode() {
        GitHubUserProfile profile =
                new GitHubUserProfile(
                        1001L,
                        "tester",
                        "Tester",
                        null
                );
        CodeArchiveUser user =
                CodeArchiveUser.create(profile, NOW);

        when(tokenCodec.hash("raw-state"))
                .thenReturn("state-hash");
        when(oauthStateRepository.consumeActive(
                "state-hash",
                NOW
        )).thenReturn(1);
        when(githubProviderClient.fetchUser(
                "github-code"
        )).thenReturn(profile);
        when(userService.upsert(profile))
                .thenReturn(user);
        when(tokenCodec.generate())
                .thenReturn("raw-exchange");
        when(tokenCodec.hash("raw-exchange"))
                .thenReturn("exchange-hash");

        AuthService.CallbackExchange result =
                authService.completeGitHubCallback(
                        "github-code",
                        "raw-state"
                );

        ArgumentCaptor<AuthExchangeCode> exchangeCaptor =
                ArgumentCaptor.forClass(
                        AuthExchangeCode.class
                );
        verify(exchangeCodeRepository)
                .save(exchangeCaptor.capture());

        assertThat(result.exchangeCode())
                .isEqualTo("raw-exchange");
        assertThat(exchangeCaptor.getValue().getCodeHash())
                .isEqualTo("exchange-hash")
                .isNotEqualTo("raw-exchange");
    }

    @Test
    void malformedOrReusedStateFailsClosedBeforeProviderCall() {
        when(tokenCodec.hash("raw-state"))
                .thenReturn("state-hash");
        when(oauthStateRepository.consumeActive(
                "state-hash",
                NOW
        )).thenReturn(0);

        assertThatThrownBy(() ->
                authService.completeGitHubCallback(
                        "github-code",
                        "raw-state"
                )
        )
                .isInstanceOfSatisfying(
                        CodeArchiveException.class,
                        exception -> assertThat(
                                exception.getErrorCode()
                        ).isEqualTo(
                                ErrorCode.AUTH_FLOW_INVALID
                        )
                );

        verify(githubProviderClient, never())
                .fetchUser(any());
    }

    @Test
    void exchangeIsSingleUseAndPersistsOnlySessionTokenHash() {
        GitHubUserProfile profile =
                new GitHubUserProfile(
                        1001L,
                        "tester",
                        null,
                        null
                );
        CodeArchiveUser user =
                CodeArchiveUser.create(profile, NOW);
        AuthExchangeCode exchangeCode =
                AuthExchangeCode.create(
                        user.getId(),
                        "exchange-hash",
                        NOW.plusSeconds(120),
                        NOW
                );

        when(tokenCodec.hash("raw-exchange"))
                .thenReturn("exchange-hash");
        when(exchangeCodeRepository.findByCodeHash(
                "exchange-hash"
        )).thenReturn(Optional.of(exchangeCode));
        when(exchangeCodeRepository.consumeActive(
                "exchange-hash",
                NOW
        )).thenReturn(1);
        when(userService.getById(user.getId()))
                .thenReturn(user);
        when(tokenCodec.generate())
                .thenReturn("raw-access-token");
        when(tokenCodec.hash("raw-access-token"))
                .thenReturn("session-hash");

        AuthService.IssuedSession result =
                authService.exchange("raw-exchange");

        ArgumentCaptor<AuthSession> sessionCaptor =
                ArgumentCaptor.forClass(AuthSession.class);
        verify(authSessionRepository)
                .save(sessionCaptor.capture());

        assertThat(result.accessToken())
                .isEqualTo("raw-access-token");
        assertThat(sessionCaptor.getValue().getTokenHash())
                .isEqualTo("session-hash")
                .isNotEqualTo("raw-access-token");
    }

    @Test
    void reusedOrExpiredExchangeCodeIsRejected() {
        UUID userId = UUID.randomUUID();
        AuthExchangeCode exchangeCode =
                AuthExchangeCode.create(
                        userId,
                        "exchange-hash",
                        NOW.minusSeconds(1),
                        NOW.minusSeconds(120)
                );

        when(tokenCodec.hash("raw-exchange"))
                .thenReturn("exchange-hash");
        when(exchangeCodeRepository.findByCodeHash(
                "exchange-hash"
        )).thenReturn(Optional.of(exchangeCode));
        when(exchangeCodeRepository.consumeActive(
                "exchange-hash",
                NOW
        )).thenReturn(0);

        assertThatThrownBy(() ->
                authService.exchange("raw-exchange")
        )
                .isInstanceOfSatisfying(
                        CodeArchiveException.class,
                        exception -> assertThat(
                                exception.getErrorCode()
                        ).isEqualTo(
                                ErrorCode.AUTH_EXCHANGE_INVALID
                        )
                );
    }

    @Test
    void activeSessionBuildsReusableAuthenticatedPrincipal() {
        GitHubUserProfile profile =
                new GitHubUserProfile(
                        1001L,
                        "tester",
                        null,
                        null
                );
        CodeArchiveUser user =
                CodeArchiveUser.create(profile, NOW);
        AuthSession session =
                AuthSession.create(
                        user.getId(),
                        "session-hash",
                        NOW.plusSeconds(60),
                        NOW
                );

        when(tokenCodec.hash("raw-access-token"))
                .thenReturn("session-hash");
        when(authSessionRepository
                .findActiveByTokenHash(
                        "session-hash",
                        NOW
                ))
                .thenReturn(Optional.of(session));
        when(userService.getById(user.getId()))
                .thenReturn(user);

        Optional<CodeArchivePrincipal> principal =
                authService.authenticate(
                        "raw-access-token"
                );

        assertThat(principal).isPresent();
        assertThat(principal.orElseThrow().userId())
                .isEqualTo(user.getId());
        assertThat(principal.orElseThrow().sessionId())
                .isEqualTo(session.getId());
        assertThat(principal.orElseThrow().githubLogin())
                .isEqualTo("tester");
    }

    @Test
    void unknownExpiredOrRevokedSessionIsRejected() {
        when(tokenCodec.hash("invalid-token"))
                .thenReturn("invalid-hash");
        when(authSessionRepository
                .findActiveByTokenHash(
                        "invalid-hash",
                        NOW
                ))
                .thenReturn(Optional.empty());

        assertThat(
                authService.authenticate("invalid-token")
        ).isEmpty();
    }

    @Test
    void logoutRevokesCurrentSession() {
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "tester"
                );

        authService.logout(principal);

        verify(authSessionRepository).revoke(
                principal.sessionId(),
                NOW
        );
    }

    @Test
    void logoutDoesNotRevokeSessionWhenRelayGrantRevocationFails() {
        CodeArchivePrincipal principal = new CodeArchivePrincipal(
                UUID.randomUUID(), UUID.randomUUID(), "tester");
        authService.setRelayGrantService(relayGrantService);
        doThrow(new IllegalStateException("relay unavailable"))
                .when(relayGrantService).revokeForUser(principal.userId());

        assertThatThrownBy(() -> authService.logout(principal))
                .isInstanceOf(IllegalStateException.class);
        verify(authSessionRepository, never()).revoke(any(), any());
    }
}
