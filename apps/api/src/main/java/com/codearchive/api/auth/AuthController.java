package com.codearchive.api.auth;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

@RestController
@RequestMapping("/api/v1/auth")
@Validated
public class AuthController {

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

    @GetMapping("/github/callback")
    public ApiResponse<AuthService.CallbackExchange> callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                authService.completeGitHubCallback(
                        code,
                        state
                ),
                requestId
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
    public ApiResponse<LogoutResponse> logout(
            @AuthenticationPrincipal
            CodeArchivePrincipal principal,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        authService.logout(principal);
        return ApiResponse.success(
                new LogoutResponse(true),
                requestId
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
