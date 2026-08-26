package com.codearchive.api.ai;

import java.util.List;
import java.util.UUID;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;
import com.fasterxml.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1")
public class AiArtifactController {

    private final AiArtifactService artifactService;

    public AiArtifactController(AiArtifactService artifactService) {
        this.artifactService = artifactService;
    }

    @PostMapping("/solutions/{solutionId}/ai-artifacts")
    public ApiResponse<AiArtifactResponse> create(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @PathVariable UUID solutionId,
            @RequestBody JsonNode body,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                artifactService.create(
                        principal,
                        solutionId,
                        AiArtifactCreateRequest.from(body)
                ),
                requestId
        );
    }

    @GetMapping("/solutions/{solutionId}/ai-artifacts")
    public ApiResponse<List<AiArtifactResponse>> list(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @PathVariable UUID solutionId,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                artifactService.list(principal, solutionId),
                requestId
        );
    }

    @GetMapping("/ai-artifacts/{artifactId}")
    public ApiResponse<AiArtifactResponse> get(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @PathVariable UUID artifactId,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                artifactService.get(principal, artifactId),
                requestId
        );
    }
}
