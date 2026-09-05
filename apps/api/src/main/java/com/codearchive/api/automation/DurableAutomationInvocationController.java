package com.codearchive.api.automation;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Enumeration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

/** Server-to-server entry point for one bounded durable automation run. */
@RestController
@RequestMapping("/api/v1/internal/automation")
public class DurableAutomationInvocationController {

    static final String PATH = "/api/v1/internal/automation/invoke";
    static final String INVOCATION_TOKEN_HEADER =
            "X-CodeArchive-Invocation-Token";
    private static final int MAX_TOKEN_LENGTH = 256;

    private final DurableAutomationWorker worker;
    private final String configuredToken;

    public DurableAutomationInvocationController(
            DurableAutomationWorker worker,
            @Value("${codearchive.automation.invocation-token:}")
            String configuredToken
    ) {
        this.worker = worker;
        this.configuredToken = configuredToken;
    }

    @PostMapping("/invoke")
    public ResponseEntity<ApiResponse<InvocationStatus>> invoke(
            HttpServletRequest request
    ) {
        String requestId = requestId(request);
        if (!configuredTokenIsUsable()) {
            throw new CodeArchiveException(
                    ErrorCode.AUTOMATION_INVOCATION_UNAVAILABLE
            );
        }
        boolean normalCredential = hasNormalCredential(request);
        boolean exactlyOneToken = hasExactlyOneInvocationToken(request);
        boolean validToken = exactlyOneToken && validInvocationToken(request);
        boolean bodyPresent = validToken && hasBody(request);
        if (normalCredential || !validToken || bodyPresent) {
            throw new CodeArchiveException(
                    bodyPresent
                            ? ErrorCode.AUTOMATION_INVOCATION_REQUEST_INVALID
                            : ErrorCode.AUTOMATION_INVOCATION_INVALID
            );
        }

        DurableAutomationWorker.Result result = worker.runOnce();
        String status = result == null ? "FAILED" : safeStatus(result.status());
        return ResponseEntity.ok(
                ApiResponse.success(new InvocationStatus(status), requestId)
        );
    }

    private boolean configuredTokenIsUsable() {
        return tokenShapeIsUsable(configuredToken);
    }

    private boolean hasExactlyOneInvocationToken(HttpServletRequest request) {
        Enumeration<String> values = request.getHeaders(INVOCATION_TOKEN_HEADER);
        if (values == null || !values.hasMoreElements()) {
            return false;
        }
        values.nextElement();
        return !values.hasMoreElements();
    }

    private boolean validInvocationToken(HttpServletRequest request) {
        String provided = request.getHeader(INVOCATION_TOKEN_HEADER);
        if (!tokenShapeIsUsable(provided)) {
            return false;
        }
        return MessageDigest.isEqual(
                digest(configuredToken),
                digest(provided)
        );
    }

    private boolean tokenShapeIsUsable(String value) {
        return value != null
                && !value.isBlank()
                && value.length() <= MAX_TOKEN_LENGTH
                && value.equals(value.trim())
                && value.chars().noneMatch(Character::isISOControl);
    }

    private boolean hasNormalCredential(HttpServletRequest request) {
        if (request.getHeader(HttpHeaders.AUTHORIZATION) != null) {
            return true;
        }
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return false;
        }
        for (Cookie cookie : cookies) {
            if (ApiAuthenticationFilter.SESSION_COOKIE_NAME.equals(
                    cookie.getName())) {
                return true;
            }
        }
        return false;
    }

    private boolean hasBody(HttpServletRequest request) {
        try {
            if (request.getContentLengthLong() > 0) {
                return true;
            }
            return request.getContentLengthLong() < 0
                    && request.getInputStream().read() != -1;
        } catch (IOException ignored) {
            return true;
        }
    }

    private String safeStatus(String status) {
        return switch (status) {
            case "IDLE", "SUCCEEDED", "UNKNOWN", "REJECTED" -> status;
            default -> "FAILED";
        };
    }

    private String requestId(HttpServletRequest request) {
        Object value = request.getAttribute(
                RequestIdFilter.REQUEST_ID_ATTRIBUTE
        );
        return value == null ? "unknown" : value.toString();
    }

    private byte[] digest(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(
                    value.getBytes(StandardCharsets.UTF_8)
            );
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }

    public record InvocationStatus(String status) {}
}
