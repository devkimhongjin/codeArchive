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
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserService;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@ExtendWith(MockitoExtension.class)
class AuthExtensionBridgeServiceTest {

    private static final Instant NOW =
            Instant.parse("2026-08-26T00:15:00Z");
    private static final String EXTENSION_REDIRECT =
            "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/codearchive-auth";
    private static final String SERVER_CALLBACK =
            "https://api.codearchive.test/api/v1/auth/github/callback";

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
        authProperties.getGithub().setClientId("mock-client-id");
        authProperties.getGithub().setClientSecret("mock-client-secret");
        authProperties.getGithub().setCallbackUrl(SERVER_CALLBACK);
        authProperties.setExtensionRedirectUri(EXTENSION_REDIRECT);
        authProperties.setStateTtl(Duration.ofMinutes(10));
        authProperties.setExchangeTtl(Duration.ofMinutes(2));

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
    void extensionStartBindsFlowAndKeepsGitHubRedirectOnServerCallback() {
        when(tokenCodec.generate()).thenReturn("raw-state");
        when(tokenCodec.hash("raw-state")).thenReturn("state-hash");

        AuthService.LoginStart result =
                authService.beginGitHubExtensionLogin();

        ArgumentCaptor<OAuthState> stateCaptor =
                ArgumentCaptor.forClass(OAuthState.class);
        verify(oauthStateRepository).save(stateCaptor.capture());

        assertThat(stateCaptor.getValue().getFlowType())
                .isEqualTo(OAuthState.FlowType.EXTENSION);
        assertThat(stateCaptor.getValue().getStateHash())
                .isEqualTo("state-hash")
                .isNotEqualTo("raw-state");
        assertThat(result.authorizationUrl())
                .contains("client_id=mock-client-id")
                .contains("state=raw-state")
                .contains("redirect_uri=https://api.codearchive.test/api/v1/auth/github/callback")
                .doesNotContain("chromiumapp.org")
                .doesNotContain("scope=")
                .doesNotContain("repo");
    }

    @Test
    void extensionStartRejectsMissingWildcardOrNonChromiumRedirects() {
        String[] invalidRedirects = {
                "",
                "http://abcdefghijklmnop.chromiumapp.org/codearchive-auth",
                "https://*.chromiumapp.org/codearchive-auth",
                "https://evil.example/codearchive-auth",
                "https://abcdefghijklmnop.chromiumapp.org/",
                "https://abcdefghijklmnop.chromiumapp.org/codearchive-auth?next=evil",
                "https://abcdefghijklmnop.chromiumapp.org/codearchive-auth#old"
        };

        for (String invalidRedirect : invalidRedirects) {
            authProperties.setExtensionRedirectUri(invalidRedirect);

            assertThatThrownBy(
                    authService::beginGitHubExtensionLogin
            ).isInstanceOfSatisfying(
                    CodeArchiveException.class,
                    exception -> assertThat(
                            exception.getErrorCode()
                    ).isEqualTo(
                            ErrorCode.AUTH_PROVIDER_UNAVAILABLE
                    )
            );
        }

        verify(oauthStateRepository, never()).save(any());
    }

    @Test
    void extensionCallbackProducesOnlyExactRedirectAndExchangeCode() {
        OAuthState state = OAuthState.create(
                "state-hash",
                OAuthState.FlowType.EXTENSION,
                NOW.plusSeconds(600),
                NOW
        );
        GitHubUserProfile profile = new GitHubUserProfile(
                3003L,
                "extension-user",
                "Extension User",
                null
        );
        CodeArchiveUser user = CodeArchiveUser.create(profile, NOW);

        when(tokenCodec.hash("raw-state")).thenReturn("state-hash");
        when(oauthStateRepository.findByStateHash("state-hash"))
                .thenReturn(java.util.Optional.of(state));
        when(oauthStateRepository.consumeActive("state-hash", NOW))
                .thenReturn(1);
        when(githubProviderClient.fetchUser("github-code"))
                .thenReturn(profile);
        when(userService.upsert(profile)).thenReturn(user);
        when(tokenCodec.generate()).thenReturn("raw-exchange");
        when(tokenCodec.hash("raw-exchange"))
                .thenReturn("exchange-hash");

        AuthService.CallbackExchange result =
                authService.completeGitHubCallback(
                        "github-code",
                        "raw-state"
                );

        assertThat(result.exchangeCode()).isEqualTo("raw-exchange");
        assertThat(result.completionRedirectUri())
                .isEqualTo(EXTENSION_REDIRECT + "#code=raw-exchange")
                .doesNotContain("accessToken")
                .doesNotContain("Bearer");

        ArgumentCaptor<AuthExchangeCode> exchangeCaptor =
                ArgumentCaptor.forClass(AuthExchangeCode.class);
        verify(exchangeCodeRepository).save(exchangeCaptor.capture());
        assertThat(exchangeCaptor.getValue().getCodeHash())
                .isEqualTo("exchange-hash")
                .isNotEqualTo("raw-exchange");
        verify(authSessionRepository, never()).save(any());
    }

    @Test
    void reusedOrExpiredExtensionStateStopsBeforeProviderAndExchange() {
        OAuthState state = OAuthState.create(
                "state-hash",
                OAuthState.FlowType.EXTENSION,
                NOW.minusSeconds(1),
                NOW.minusSeconds(600)
        );
        when(tokenCodec.hash("raw-state")).thenReturn("state-hash");
        when(oauthStateRepository.findByStateHash("state-hash"))
                .thenReturn(java.util.Optional.of(state));
        when(oauthStateRepository.consumeActive("state-hash", NOW))
                .thenReturn(0);

        assertThatThrownBy(() ->
                authService.completeGitHubCallback(
                        "github-code",
                        "raw-state"
                )
        ).isInstanceOfSatisfying(
                CodeArchiveException.class,
                exception -> assertThat(
                        exception.getErrorCode()
                ).isEqualTo(ErrorCode.AUTH_FLOW_INVALID)
        );

        verify(githubProviderClient, never()).fetchUser(any());
        verify(exchangeCodeRepository, never()).save(any());
    }
}
