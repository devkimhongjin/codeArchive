package com.codearchive.api.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public final class RequestCorrelationFilter extends OncePerRequestFilter {
    public static final String RESPONSE_HEADER = "X-Request-Id";
    public static final String MDC_KEY = "requestId";
    private static final String RENDER_REQUEST_HEADER = "Rndr-Id";
    private static final int MAX_ID_LENGTH = 128;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = trustedRenderRequestId(request.getHeader(RENDER_REQUEST_HEADER));
        if (requestId == null) {
            requestId = UUID.randomUUID().toString();
        }
        response.setHeader(RESPONSE_HEADER, requestId);
        MDC.put(MDC_KEY, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    private String trustedRenderRequestId(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_ID_LENGTH) {
            return null;
        }
        return value.matches("[A-Za-z0-9_-]+") ? value : null;
    }
}
