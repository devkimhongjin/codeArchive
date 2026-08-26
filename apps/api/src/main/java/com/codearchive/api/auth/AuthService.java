package com.codearchive.api.auth;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

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
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonIgnore;

@Service
public class AuthService {

    private static final String CHROMIUM_APP_SUFFIX =
            ".chromiumapp.org";

    private final AuthProperties authProperties;
    private final GitHubProviderClient githubProviderClient;
    private final OAuthStateRepository oauthStateRepository;
    private final AuthExchangeCodeRepository exchangeCodeRepository;
    private final AuthSessionRepository authSessionRepository;
    private final UserService userService;
    private final SecureTokenCodec tokenCodec;
    private final Clock clock;

    @Autowired
    public AuthService(
            AuthProperties authProperties,
            GitHubProviderClient githubProviderClient,
            OAuthStateRepository oauthStateRepository,
            AuthExchangeCodeRepository exchangeCodeRepository,
            AuthSessionRepository authSessionRepository,
            UserService userService,
            SecureTokenCodec tokenCodec
    ) {
        this(
                authProperties,
                githubProviderClient,
                oauthStateRepository,
                exchangeCodeRepository,
                authSessionRepository,
                userService,
                tokenCodec,
                Clock.systemUTC()
        );
    }

    AuthService(
            AuthProperties authProperties,
            GitHubProviderClient githubProviderClient,
            OAuthStateRepository oauthStateRepository,
            AuthExchangeCodeRepository exchangeCodeRepository,
            AuthSessionRepository authSessionRepository,
            UserService userService,
            SecureTokenCodec tokenCodec,
            Clock clock
    ) {
        this.authProperties = authProperties;
        this.githubProviderClient = githubProviderClient;
        this.oauthStateRepository = oauthStateRepository;
        this.exchangeCodeRepository = exchangeCodeRepository;
        this.authSessionRepository = authSessionRepository;
        this.userService = userService;
        this.tokenCodec = tokenCodec;
        this.clock = clock;
    }

    public LoginStart beginGitHubLogin() {
        return beginGitHubLogin(OAuthState.FlowType.GENERIC);
    }

    public LoginStart beginGitHubExtensionLogin() {
        requireExtensionRedirectUri();
        return beginGitHubLogin(OAuthState.FlowType.EXTENSION);
    }

    private LoginStart beginGitHubLogin(
            OAuthState.FlowType flowType
    ) {
        ensureProviderConfigured();

        Instant now = clock.instant();
        Instant expiresAt = now.plus(
                authProperties.getStateTtl()
        );
        String rawState = tokenCodec.generate();

        oauthStateRepository.save(
                OAuthState.create(
                        tokenCodec.hash(rawState),
                        flowType,
                        expiresAt,
                        now
                )
        );

        AuthProperties.Github github =
                authProperties.getGithub();

        String authorizationUrl = UriComponentsBuilder
                .fromUriString(github.getAuthorizeUrl())
                .queryParam("client_id", github.getClientId())
                .queryParam(
                        "redirect_uri",
                        github.getCallbackUrl()
                )
                .queryParam("state", rawState)
                .build()
                .encode()
                .toUriString();

        return new LoginStart(
                authorizationUrl,
                expiresAt
        );
    }

    public CallbackExchange completeGitHubCallback(
            String authorizationCode,
            String rawState
    ) {
        ensureProviderConfigured();

        if (isBlank(authorizationCode)
                || isBlank(rawState)) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_FLOW_INVALID
            );
        }

        Instant now = clock.instant();
        String stateHash = tokenCodec.hash(rawState);
        OAuthState oauthState = oauthStateRepository
                .findByStateHash(stateHash)
                .orElseThrow(() -> new CodeArchiveException(
                        ErrorCode.AUTH_FLOW_INVALID
                ));

        String completionRedirectUri = null;
        if (oauthState.getFlowType()
                == OAuthState.FlowType.EXTENSION) {
            completionRedirectUri =
                    requireExtensionRedirectUri();
        }

        if (oauthStateRepository.consumeActive(
                stateHash,
                now
        ) != 1) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_FLOW_INVALID
            );
        }

        GitHubUserProfile profile =
                githubProviderClient.fetchUser(
                        authorizationCode
                );
        CodeArchiveUser user = userService.upsert(profile);

        String rawExchangeCode = tokenCodec.generate();
        Instant expiresAt = now.plus(
                authProperties.getExchangeTtl()
        );

        exchangeCodeRepository.save(
                AuthExchangeCode.create(
                        user.getId(),
                        tokenCodec.hash(rawExchangeCode),
                        expiresAt,
                        now
                )
        );

        return new CallbackExchange(
                rawExchangeCode,
                expiresAt,
                completionRedirectUri == null
                        ? null
                        : completionRedirectUri
                                + "#code="
                                + rawExchangeCode
        );
    }

    public IssuedSession exchange(String rawExchangeCode) {
        if (isBlank(rawExchangeCode)) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_EXCHANGE_INVALID
            );
        }

        Instant now = clock.instant();
        String codeHash = tokenCodec.hash(
                rawExchangeCode
        );
        AuthExchangeCode exchangeCode =
                exchangeCodeRepository
                        .findByCodeHash(codeHash)
                        .orElseThrow(() ->
                                new CodeArchiveException(
                                        ErrorCode.AUTH_EXCHANGE_INVALID
                                )
                        );

        if (exchangeCodeRepository.consumeActive(
                codeHash,
                now
        ) != 1) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_EXCHANGE_INVALID
            );
        }

        CodeArchiveUser user = userService.getById(
                exchangeCode.getUserId()
        );

        String rawAccessToken = tokenCodec.generate();
        Instant expiresAt = now.plus(
                authProperties.getSessionTtl()
        );

        authSessionRepository.save(
                AuthSession.create(
                        user.getId(),
                        tokenCodec.hash(rawAccessToken),
                        expiresAt,
                        now
                )
        );

        return new IssuedSession(
                rawAccessToken,
                expiresAt
        );
    }

    public Optional<CodeArchivePrincipal> authenticate(
            String rawAccessToken
    ) {
        if (isBlank(rawAccessToken)) {
            return Optional.empty();
        }

        Instant now = clock.instant();

        return authSessionRepository
                .findActiveByTokenHash(
                        tokenCodec.hash(rawAccessToken),
                        now
                )
                .flatMap(session -> {
                    try {
                        CodeArchiveUser user =
                                userService.getById(
                                        session.getUserId()
                                );
                        return Optional.of(
                                new CodeArchivePrincipal(
                                        user.getId(),
                                        session.getId(),
                                        user.getGithubLogin()
                                )
                        );
                    } catch (CodeArchiveException exception) {
                        return Optional.empty();
                    }
                });
    }

    public void logout(CodeArchivePrincipal principal) {
        if (principal == null) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_REQUIRED
            );
        }
        authSessionRepository.revoke(
                principal.sessionId(),
                clock.instant()
        );
    }

    public CodeArchiveUser currentUser(
            CodeArchivePrincipal principal
    ) {
        if (principal == null) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_REQUIRED
            );
        }
        return userService.getById(principal.userId());
    }

    private String requireExtensionRedirectUri() {
        String configured =
                authProperties.getExtensionRedirectUri();
        if (isBlank(configured)) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_PROVIDER_UNAVAILABLE
            );
        }

        String redirectUri = configured.trim();
        URI uri;
        try {
            uri = URI.create(redirectUri);
        } catch (IllegalArgumentException exception) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_PROVIDER_UNAVAILABLE
            );
        }

        String host = uri.getHost();
        boolean valid = "https".equalsIgnoreCase(
                uri.getScheme()
        )
                && host != null
                && host.endsWith(CHROMIUM_APP_SUFFIX)
                && host.length() > CHROMIUM_APP_SUFFIX.length()
                && !redirectUri.contains("*")
                && uri.getUserInfo() == null
                && uri.getPort() == -1
                && uri.getRawQuery() == null
                && uri.getRawFragment() == null
                && uri.getRawPath() != null
                && !uri.getRawPath().isBlank()
                && !"/".equals(uri.getRawPath());

        if (!valid) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_PROVIDER_UNAVAILABLE
            );
        }
        return redirectUri;
    }

    private void ensureProviderConfigured() {
        AuthProperties.Github github =
                authProperties.getGithub();

        if (isBlank(github.getClientId())
                || isBlank(github.getClientSecret())
                || isBlank(github.getCallbackUrl())) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_PROVIDER_UNAVAILABLE
            );
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    public record LoginStart(
            String authorizationUrl,
            Instant expiresAt
    ) {
    }

    public record CallbackExchange(
            String exchangeCode,
            Instant expiresAt,
            @JsonIgnore String completionRedirectUri
    ) {
        public CallbackExchange(
                String exchangeCode,
                Instant expiresAt
        ) {
            this(exchangeCode, expiresAt, null);
        }
    }

    public record IssuedSession(
            String accessToken,
            Instant expiresAt
    ) {
    }
}
