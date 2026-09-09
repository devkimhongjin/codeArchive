package com.codearchive.api.relay;

import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.codearchive.api.common.filter.RequestIdFilter;

import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.codearchive.api.auth.security.JsonAuthenticationEntryPoint;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Resolves a relay bearer only for the exact ingest route. A valid relay
 * credential presented to any other API route is rejected, never downgraded
 * into an ordinary Dashboard credential.
 */
public class RelayGrantAuthenticationFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(RelayGrantAuthenticationFilter.class);

    public static final String RELAY_INGEST_PATH = "/api/v1/relay/captures";
    public static final String RELAY_AUTHORITY = "RELAY_INGEST";
    private static final String DURABLE_INVOCATION_PATH =
            "/api/v1/internal/automation/invoke";

    private final RelayGrantService grants;
    private final JsonAuthenticationEntryPoint entryPoint =
            new JsonAuthenticationEntryPoint();

    public RelayGrantAuthenticationFilter(RelayGrantService grants) {
        this.grants = grants;
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

        String bearer = bearer(request);
        if (bearer == null) {
            if (isIngest(request)) logRejection(request, "MISSING_BEARER");
            filterChain.doFilter(request, response);
            return;
        }

        var principal = grants.authenticate(bearer);
        if (isIngest(request)) {
            if (principal.isEmpty()) {
                String reason;
                try { reason = grants.authenticationRejectionReason(bearer); }
                catch (RuntimeException ignored) { reason = "DIAGNOSTIC_UNAVAILABLE"; }
                logRejection(request, reason);
                entryPoint.commence(request, response,
                        new org.springframework.security.authentication.BadCredentialsException(
                                "Invalid relay credential"));
                return;
            }
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(
                            principal.get(), null, List.of(() -> RELAY_AUTHORITY))
            );
            filterChain.doFilter(request, response);
            return;
        }

        // A relay token is never a general API/session token.
        if (principal.isPresent()) {
            entryPoint.commence(request, response,
                    new org.springframework.security.authentication.BadCredentialsException(
                            "Relay credential cannot access this route"));
            return;
        }
        filterChain.doFilter(request, response);
    }

    private boolean isDurableInvocation(HttpServletRequest request) {
        String context = request.getContextPath() == null
                ? "" : request.getContextPath();
        return "POST".equals(request.getMethod())
                && (context + DURABLE_INVOCATION_PATH).equals(
                        request.getRequestURI()
                );
    }

    private void logRejection(HttpServletRequest request, String reason) {
        log.info("relay_auth_rejected requestId={} reason={}",
                request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE), reason);
    }

    private boolean isIngest(HttpServletRequest request) {
        String context = request.getContextPath() == null
                ? "" : request.getContextPath();
        return "POST".equals(request.getMethod())
                && (context + RELAY_INGEST_PATH).equals(request.getRequestURI());
    }

    private String bearer(HttpServletRequest request) {
        String value = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (value == null || !value.startsWith("Bearer ")) return null;
        String token = value.substring("Bearer ".length()).trim();
        return token.isBlank() ? null : token;
    }
}
