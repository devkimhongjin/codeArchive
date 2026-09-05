package com.codearchive.api.auth.security;

import java.io.IOException;
import java.util.List;
import java.util.Set;

import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.codearchive.api.auth.AuthService;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class ApiAuthenticationFilter extends OncePerRequestFilter {

    public static final String SESSION_COOKIE_NAME =
            "__Host-codearchive_session";
    private static final String DURABLE_INVOCATION_PATH =
            "/api/v1/internal/automation/invoke";

    private static final String BEARER_PREFIX = "Bearer ";
    private static final Set<String> UNSAFE_METHODS =
            Set.of("POST", "PUT", "PATCH", "DELETE");

    private final AuthService authService;
    private final String dashboardOrigin;
    private final JsonAuthenticationEntryPoint authenticationEntryPoint =
            new JsonAuthenticationEntryPoint();

    public ApiAuthenticationFilter(
            AuthService authService,
            String dashboardOrigin
    ) {
        this.authService = authService;
        this.dashboardOrigin = dashboardOrigin;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        if (isDurableInvocation(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        String bearerToken = bearerToken(request);
        String cookieToken = cookieValue(
                request,
                SESSION_COOKIE_NAME
        );

        if (bearerToken != null && cookieToken != null) {
            rejectAuthentication(request, response);
            return;
        }

        if (cookieToken != null) {
            if (dashboardOrigin == null) {
                rejectAuthentication(request, response);
                return;
            }

            if (UNSAFE_METHODS.contains(request.getMethod())) {
                String origin = request.getHeader(
                        HttpHeaders.ORIGIN
                );
                if (!dashboardOrigin.equals(origin)) {
                    response.setStatus(
                            HttpServletResponse.SC_FORBIDDEN
                    );
                    return;
                }
            }
        }

        String rawToken = cookieToken != null
                ? cookieToken
                : bearerToken;

        if (rawToken != null) {
            authService.authenticate(rawToken)
                    .ifPresent(principal ->
                            SecurityContextHolder
                                    .getContext()
                                    .setAuthentication(
                                            new UsernamePasswordAuthenticationToken(
                                                    principal,
                                                    null,
                                                    List.of()
                                            )
                                    )
                    );
        }

        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private boolean isDurableInvocation(HttpServletRequest request) {
        String context = request.getContextPath() == null
                ? "" : request.getContextPath();
        return "POST".equals(request.getMethod())
                && (context + DURABLE_INVOCATION_PATH).equals(
                        request.getRequestURI()
                );
    }

    private String bearerToken(HttpServletRequest request) {
        String authorization = request.getHeader(
                HttpHeaders.AUTHORIZATION
        );
        if (authorization == null
                || !authorization.startsWith(BEARER_PREFIX)) {
            return null;
        }

        String token = authorization
                .substring(BEARER_PREFIX.length())
                .trim();
        return token.isBlank() ? null : token;
    }

    private String cookieValue(
            HttpServletRequest request,
            String name
    ) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }

        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName())
                    && cookie.getValue() != null
                    && !cookie.getValue().isBlank()) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private void rejectAuthentication(
            HttpServletRequest request,
            HttpServletResponse response
    ) throws IOException {
        authenticationEntryPoint.commence(
                request,
                response,
                new BadCredentialsException(
                        "Ambiguous or unavailable authentication context"
                )
        );
    }
}
