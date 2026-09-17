package com.codearchive.api.auth;

import com.codearchive.api.common.ApiError;
import com.codearchive.api.config.GithubOAuth2AvailabilityFilter;
import com.codearchive.api.config.GithubOAuth2Properties;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@Validated
public class AuthController {

    private final UserRepository userRepository;
    private final GithubOAuth2Properties githubProperties;

    public AuthController(UserRepository userRepository, GithubOAuth2Properties githubProperties) {
        this.userRepository = userRepository;
        this.githubProperties = githubProperties;
    }

    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken csrfToken, HttpServletResponse response) {
        String token = csrfToken.getToken();
        // CookieCsrfTokenRepository writes this cookie during normal filter processing. The explicit
        // header keeps the contract deterministic for clients and MockMvc when the token is deferred.
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from("XSRF-TOKEN", token)
                .path("/")
                .httpOnly(false)
                .sameSite("Lax")
                .build()
                .toString());
        return new CsrfResponse(token);
    }

    @GetMapping("/providers")
    public Map<String, GithubProviderResponse> providers() {
        return Map.of("github", new GithubProviderResponse(
                githubProperties.isEnabled(), GithubOAuth2AvailabilityFilter.AUTHORIZATION_PATH));
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(Authentication authentication) {
        return GithubAuthentication.identity(authentication)
                .flatMap(identity -> userRepository.findByGithubId(identity.githubId()))
                .<ResponseEntity<?>>map(user -> ResponseEntity.ok(UserResponse.from(user)))
                .orElseGet(() -> ResponseEntity.status(401).body(new ApiError("Authentication is required")));
    }

    /**
     * Keep a deliberate migration response for clients that still post the old
     * email/password payload. No credentials are read or authenticated.
     */
    @PostMapping({"/register", "/login"})
    public ResponseEntity<ApiError> legacyPasswordAuth() {
        return ResponseEntity.status(410)
                .body(new ApiError("Email and password authentication has been removed; use GitHub"));
    }

    public record GithubProviderResponse(boolean enabled, String loginUrl) {
    }
}
