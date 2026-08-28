package com.codearchive.api.auth.security;

import java.io.IOException;

import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;

import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.common.filter.RequestIdFilter;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class JsonAuthenticationEntryPoint
        implements AuthenticationEntryPoint {

    @Override
    public void commence(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthenticationException authException
    ) throws IOException {
        Object requestIdValue = request.getAttribute(
                RequestIdFilter.REQUEST_ID_ATTRIBUTE
        );
        String requestId = requestIdValue == null
                ? "unknown"
                : requestIdValue.toString();

        response.setStatus(
                ErrorCode.AUTH_REQUIRED
                        .getStatus()
                        .value()
        );
        response.setContentType(
                MediaType.APPLICATION_JSON_VALUE
        );
        response.setCharacterEncoding(
                java.nio.charset.StandardCharsets.UTF_8.name()
        );

        response.getWriter().write(
                "{"
                        + "\"success\":false,"
                        + "\"data\":null,"
                        + "\"error\":{"
                        + "\"code\":\"AUTH_REQUIRED\","
                        + "\"message\":\""
                        + ErrorCode.AUTH_REQUIRED.getMessage()
                        + "\","
                        + "\"details\":{}"
                        + "},"
                        + "\"requestId\":\""
                        + escape(requestId)
                        + "\""
                        + "}"
        );
    }

    private String escape(String value) {
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"");
    }
}
