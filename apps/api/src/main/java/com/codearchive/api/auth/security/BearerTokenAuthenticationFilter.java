package com.codearchive.api.auth.security;

import java.io.IOException;
import java.util.List;

import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.codearchive.api.auth.AuthService;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class BearerTokenAuthenticationFilter
        extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final AuthService authService;

    public BearerTokenAuthenticationFilter(
            AuthService authService
    ) {
        this.authService = authService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String authorization = request.getHeader(
                HttpHeaders.AUTHORIZATION
        );

        if (authorization != null
                && authorization.startsWith(BEARER_PREFIX)) {
            String rawToken = authorization
                    .substring(BEARER_PREFIX.length())
                    .trim();

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
}
