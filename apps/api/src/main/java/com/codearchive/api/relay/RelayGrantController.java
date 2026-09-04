package com.codearchive.api.relay;

import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/v1/relay/grants")
@Validated
public class RelayGrantController {

    private final RelayGrantService service;

    public RelayGrantController(RelayGrantService service) {
        this.service = service;
    }

    @PostMapping("/challenge")
    public ApiResponse<RelayGrantService.ChallengeResponse> challenge(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestHeader(HttpHeaders.ORIGIN) String origin,
            @Valid @RequestBody RelayGrantService.ChallengeRequest request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        return ApiResponse.success(service.challenge(principal, origin, request), requestId);
    }

    @PostMapping
    public ApiResponse<RelayGrantService.GrantResponse> issue(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestHeader(HttpHeaders.ORIGIN) String origin,
            @Valid @RequestBody RelayGrantService.GrantRequest request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        return ApiResponse.success(service.issue(principal, origin, request), requestId);
    }

    @DeleteMapping("/{grantId}")
    public ApiResponse<Void> revoke(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestHeader(HttpHeaders.ORIGIN) String origin,
            @PathVariable UUID grantId,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        service.revoke(principal, origin, grantId);
        return ApiResponse.success(null, requestId);
    }

    @PostMapping("/{grantId}/rotate")
    public ApiResponse<RelayGrantService.GrantResponse> rotate(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestHeader(HttpHeaders.ORIGIN) String origin,
            @PathVariable UUID grantId,
            @Valid @RequestBody RelayGrantService.GrantRequest request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        return ApiResponse.success(service.rotate(principal, origin, grantId, request), requestId);
    }
}
