package com.codearchive.api.automation;

import org.springframework.http.HttpHeaders;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1/automation")
public class DurableAutomationProfileController {

    private final DurableAutomationProfileService service;

    public DurableAutomationProfileController(DurableAutomationProfileService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<DurableAutomationProfileStore.Profile> get(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestHeader(HttpHeaders.ORIGIN) String origin,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        return ApiResponse.success(service.get(principal, origin), requestId);
    }

    @PutMapping
    public ApiResponse<DurableAutomationProfileStore.Profile> update(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestHeader(HttpHeaders.ORIGIN) String origin,
            @RequestBody DurableAutomationProfileService.UpdateRequest request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        return ApiResponse.success(service.update(principal, origin, request), requestId);
    }
}
