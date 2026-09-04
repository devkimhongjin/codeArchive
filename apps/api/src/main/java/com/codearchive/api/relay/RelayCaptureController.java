package com.codearchive.api.relay;

import org.springframework.http.HttpHeaders;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1/relay/captures")
public class RelayCaptureController {

    private final RelayCaptureIngestService service;

    public RelayCaptureController(RelayCaptureIngestService service) {
        this.service = service;
    }

    @PostMapping
    public ApiResponse<RelayCaptureIngestService.Response> ingest(
            @AuthenticationPrincipal RelayGrantPrincipal principal,
            @RequestBody RelayCaptureIngestService.Request request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId
    ) {
        return ApiResponse.success(service.ingest(principal, request), requestId);
    }
}
