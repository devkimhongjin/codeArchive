package com.codearchive.api.auth;

import java.net.URI;
import java.time.Duration;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

@RestController
@RequestMapping("/api/v1/auth")
@Validated
public class AuthController {

    static final String OAUTH_STATE_COOKIE_NAME =
            "__Secure-codearchive_oauth_state";
    static final String OAUTH_STATE_COOKIE_PATH =
            "/api/v1/auth/github";

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/github/login")
    public ApiResponse<AuthService.LoginStart> login(
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                authService.beginGitHubLogin(),
                requestId
        );
    }

    @GetMapping("/github/extension-login")
    public ApiResponse<AuthService.LoginStart> extensionLogin(
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                authService.beginGitHubExtensionLogin(),
                requestId
        );
    }

    @GetMapping("/github/dashboard-login")
    public ResponseEntity<Void> dashboardLogin() {
        AuthService.DashboardLoginStart start =
                authService.beginGitHubDashboardLogin();

        ResponseCookie stateCookie = ResponseCookie
                .from(
                        OAUTH_STATE_COOKIE_NAME,
                        start.rawState()
                )
                .httpOnly(true)
                .secure(true)
                .sameSite("Lax")
                .path(OAUTH_STATE_COOKIE_PATH)
                .maxAge(authService.oauthStateTtl())
                .build();

        return ResponseEntity
                .status(HttpStatus.FOUND)
                .location(URI.create(start.authorizationUrl()))
                .header(
                        HttpHeaders.SET_COOKIE,
                        stateCookie.toString()
                )
                .cacheControl(
                        org.springframework.http.CacheControl
                                .noStore()
                )
                .build();
    }

    @GetMapping("/github/callback")
    public ResponseEntity<?> callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @CookieValue(
                    name = OAUTH_STATE_COOKIE_NAME,
                    required = false
            ) String preAuthStateCookie,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        AuthService.CallbackExchange completion =
                preAuthStateCookie == null
                        ? authService.completeGitHubCallback(
                                code,
                                state
                        )
                        : authService.completeGitHubCallback(
                                code,
                                state,
                                preAuthStateCookie
                        );

        if (completion.dashboardSession() != null) {
            ResponseCookie sessionCookie = ResponseCookie
                    .from(
                            ApiAuthenticationFilter
                                    .SESSION_COOKIE_NAME,
                            completion.dashboardSession()
                                    .accessToken()
                    )
                    .httpOnly(true)
                    .secure(true)
                    .sameSite("Lax")
                    .path("/")
                    .maxAge(authService.sessionTtl())
                    .build();

            ResponseCookie clearStateCookie = ResponseCookie
                    .from(
                            OAUTH_STATE_COOKIE_NAME,
                            ""
                    )
                    .httpOnly(true)
                    .secure(true)
                    .sameSite("Lax")
                    .path(OAUTH_STATE_COOKIE_PATH)
                    .maxAge(Duration.ZERO)
                    .build();

            return ResponseEntity
                    .status(HttpStatus.SEE_OTHER)
                    .location(URI.create(
                            completion.completionRedirectUri()
                    ))
                    .header(
                            HttpHeaders.SET_COOKIE,
                            sessionCookie.toString(),
                            clearStateCookie.toString()
                    )
                    .cacheControl(
                            org.springframework.http.CacheControl
                                    .noStore()
                    )
                    .header(
                            "Referrer-Policy",
                            "no-referrer"
                    )
                    .build();
        }

        if (completion.completionRedirectUri() != null) {
            return ResponseEntity
                    .status(HttpStatus.FOUND)
                    .location(URI.create(
                            completion.completionRedirectUri()
                    ))
                    .build();
        }

        return ResponseEntity.ok(
                ApiResponse.success(
                        completion,
                        requestId
                )
        );
    }

    @PostMapping("/exchange")
    public ApiResponse<AuthService.IssuedSession> exchange(
            @Valid @RequestBody ExchangeRequest request,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                authService.exchange(request.code()),
                requestId
        );
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<LogoutResponse>> logout(
            @AuthenticationPrincipal
            CodeArchivePrincipal principal,
            @CookieValue(
                    name = ApiAuthenticationFilter
                            .SESSION_COOKIE_NAME,
                    required = false
            ) String dashboardSessionCookie,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        authService.logout(principal);

        ResponseEntity.BodyBuilder response =
                ResponseEntity.ok();

        if (dashboardSessionCookie != null
                && !dashboardSessionCookie.isBlank()) {
            ResponseCookie clearSessionCookie = ResponseCookie
                    .from(
                            ApiAuthenticationFilter
                                    .SESSION_COOKIE_NAME,
                            ""
                    )
                    .httpOnly(true)
                    .secure(true)
                    .sameSite("Lax")
                    .path("/")
                    .maxAge(Duration.ZERO)
                    .build();

            response.header(
                    HttpHeaders.SET_COOKIE,
                    clearSessionCookie.toString()
            );
        }

        return response.body(
                ApiResponse.success(
                        new LogoutResponse(true),
                        requestId
                )
        );
    }

    public record ExchangeRequest(
            @NotBlank String code
    ) {
    }

    public record LogoutResponse(
            boolean revoked
    ) {
    }
}
