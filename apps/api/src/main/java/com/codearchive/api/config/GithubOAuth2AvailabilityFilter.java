package com.codearchive.api.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/** Returns a deterministic 503 when OAuth credentials are not configured. */
public class GithubOAuth2AvailabilityFilter extends OncePerRequestFilter {

    public static final String AUTHORIZATION_PATH = "/api/oauth2/authorization/github";

    private final GithubOAuth2Properties properties;

    public GithubOAuth2AvailabilityFilter(GithubOAuth2Properties properties) {
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (!properties.isEnabled() && "GET".equalsIgnoreCase(request.getMethod())
                && AUTHORIZATION_PATH.equals(request.getRequestURI())) {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"message\":\"GitHub login is unavailable\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}
