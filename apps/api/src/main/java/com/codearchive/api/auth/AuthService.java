package com.codearchive.api.auth;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.auth.config.DashboardOriginValidator;
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
    private RelayGrantService relayGrantService;

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
        LoginMaterial material = beginGitHubLogin(
                OAuthState.FlowType.GENERIC
        );
        return new LoginStart(
                material.authorizationUrl(),
                material.expiresAt()
        );
    }

    public LoginStart beginGitHubExtensionLogin() {
        requireExtensionRedirectUri();
        LoginMaterial material = beginGitHubLogin(
                OAuthState.FlowType.EXTENSION
        );
        return new LoginStart(
                material.authorizationUrl(),
                material.expiresAt()
        );
    }

    public DashboardLoginStart beginGitHubDashboardLogin() {
        requireDashboardOriginRoot();
        LoginMaterial material = beginGitHubLogin(
                OAuthState.FlowType.DASHBOARD
        );
        return new DashboardLoginStart(
                material.authorizationUrl(),
                material.rawState(),
                material.expiresAt()
        );
    }

    private LoginMaterial beginGitHubLogin(
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

        UriComponentsBuilder authorization = UriComponentsBuilder
                .fromUriString(github.getAuthorizeUrl())
                .queryParam("client_id", github.getClientId())
                .queryParam(
                        "redirect_uri",
                        github.getCallbackUrl()
                )
                .queryParam("state", rawState);

        if (flowType == OAuthState.FlowType.DASHBOARD) {
            authorization.queryParam("prompt", "select_account");
        }

        String authorizationUrl = authorization
                .build()
                .encode()
                .toUriString();

        return new LoginMaterial(
                authorizationUrl,
                rawState,
                expiresAt
        );
    }

    public CallbackExchange completeGitHubCallback(
            String authorizationCode,
            String rawState
    ) {
        return completeGitHubCallback(
                authorizationCode,
                rawState,
                null
        );
    }

    public CallbackExchange completeGitHubCallback(
            String authorizationCode,
            String rawState,
            String preAuthStateCookie
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
        OAuthState.FlowType flowType = oauthStateRepository
                .findByStateHash(stateHash)
                .map(OAuthState::getFlowType)
                .orElse(OAuthState.FlowType.GENERIC);

        String completionRedirectUri = null;
        if (flowType == OAuthState.FlowType.EXTENSION) {
            completionRedirectUri =
                    requireExtensionRedirectUri();
        } else if (flowType == OAuthState.FlowType.DASHBOARD) {
            completionRedirectUri =
                    requireDashboardOriginRoot();

            if (isBlank(preAuthStateCookie)
                    || !constantTimeStateMatch(
                            stateHash,
                            tokenCodec.hash(
                                    preAuthStateCookie
                            )
                    )) {
                throw new CodeArchiveException(
                        ErrorCode.AUTH_FLOW_INVALID
                );
            }
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

        if (flowType == OAuthState.FlowType.DASHBOARD) {
            IssuedSession session = issueSession(
                    user,
                    now
            );
            return new CallbackExchange(
                    null,
                    session.expiresAt(),
                    completionRedirectUri,
                    session
            );
        }

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
                                + rawExchangeCode,
                null
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

        return issueSession(user, now);
    }

    private IssuedSession issueSession(
            CodeArchiveUser user,
            Instant now
    ) {
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
        Instant now = clock.instant();
        if (relayGrantService != null) relayGrantService.revokeForUser(principal.userId());
        authSessionRepository.revoke(
                principal.sessionId(),
                now
        );
    }

    @Autowired(required = false)
    public void setRelayGrantService(RelayGrantService relayGrantService) {
        this.relayGrantService = relayGrantService;
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

    public Duration oauthStateTtl() {
        return authProperties.getStateTtl();
    }

    public Duration sessionTtl() {
        return authProperties.getSessionTtl();
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

    private String requireDashboardOriginRoot() {
        return DashboardOriginValidator
                .normalize(authProperties.getDashboardOrigin())
                .map(origin -> origin + "/")
                .orElseThrow(() ->
                        new CodeArchiveException(
                                ErrorCode.AUTH_PROVIDER_UNAVAILABLE
                        )
                );
    }

    private boolean constantTimeStateMatch(
            String expectedHash,
            String actualHash
    ) {
        return MessageDigest.isEqual(
                expectedHash.getBytes(StandardCharsets.UTF_8),
                actualHash.getBytes(StandardCharsets.UTF_8)
        );
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

    private record LoginMaterial(
            String authorizationUrl,
            String rawState,
            Instant expiresAt
    ) {
    }

    public record LoginStart(
            String authorizationUrl,
            Instant expiresAt
    ) {
    }

    public record DashboardLoginStart(
            @JsonIgnore String authorizationUrl,
            @JsonIgnore String rawState,
            Instant expiresAt
    ) {
    }

    public record CallbackExchange(
            String exchangeCode,
            Instant expiresAt,
            @JsonIgnore String completionRedirectUri,
            @JsonIgnore IssuedSession dashboardSession
    ) {
        public CallbackExchange(
                String exchangeCode,
                Instant expiresAt
        ) {
            this(exchangeCode, expiresAt, null, null);
        }

        public CallbackExchange(
                String exchangeCode,
                Instant expiresAt,
                String completionRedirectUri
        ) {
            this(
                    exchangeCode,
                    expiresAt,
                    completionRedirectUri,
                    null
            );
        }
    }

    public record IssuedSession(
            String accessToken,
            Instant expiresAt
    ) {
    }
}
