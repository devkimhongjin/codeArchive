package com.codearchive.api.auth.beta;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.config.DashboardOriginValidator;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiError;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Convenience entry screen only: this does not authorize or restrict other APIs. */
@RestController
public class BetaAccessController {
    private final SecureTokenCodec codec = new SecureTokenCodec();
    private final byte[] expectedHash;
    private final String dashboardOrigin;

    public BetaAccessController(
            @Value("${codearchive.beta-access.password:}") String password,
            @Value("${codearchive.auth.dashboard-origin:}") String dashboardOrigin) {
        this.expectedHash = !password.isBlank() && password.length() >= 8 && password.length() <= 128
                ? hash(password) : null;
        this.dashboardOrigin = DashboardOriginValidator.normalize(dashboardOrigin).orElse(null);
    }

    @PostMapping(value = "/api/v1/beta/access", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> check(@Valid @RequestBody PasswordRequest body,
            @RequestHeader(name = HttpHeaders.ORIGIN, required = false) String origin,
            HttpServletRequest request) {
        if (dashboardOrigin == null || !dashboardOrigin.equals(origin)) {
            throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
        }
        Object requestIdValue = request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE);
        String requestId = requestIdValue == null ? "unknown" : requestIdValue.toString();
        ErrorCode error = expectedHash == null ? ErrorCode.BETA_ACCESS_UNAVAILABLE
                : MessageDigest.isEqual(expectedHash, hash(body.password())) ? null : ErrorCode.BETA_ACCESS_REQUIRED;
        if (error != null) {
            return ResponseEntity.status(error.getStatus()).cacheControl(CacheControl.noStore())
                    .body(ApiResponse.failure(ApiError.of(error.name(), error.getMessage()), requestId));
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ApiResponse.success(new EntryAccepted(true), requestId));
    }

    private byte[] hash(String value) {
        return codec.hash(value).getBytes(StandardCharsets.US_ASCII);
    }

    public record EntryAccepted(boolean accepted) {}

    public record PasswordRequest(@NotBlank @Size(max = 128) String password) {
        @Override public String toString() { return "PasswordRequest[REDACTED]"; }
    }
}
