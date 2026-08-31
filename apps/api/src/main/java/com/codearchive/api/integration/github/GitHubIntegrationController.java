package com.codearchive.api.integration.github;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;
import com.codearchive.api.integration.github.GitHubIntegrationService.InstallationsResponse;
import com.codearchive.api.integration.github.GitHubIntegrationService.RepositoriesResponse;

@RestController
@RequestMapping("/api/v1/integrations/github")
public class GitHubIntegrationController {
    private final GitHubIntegrationService service;

    public GitHubIntegrationController(GitHubIntegrationService service) {
        this.service = service;
    }

    @GetMapping("/installations")
    public ResponseEntity<ApiResponse<InstallationsResponse>> installations(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return response(service.installations(principal), requestId);
    }

    @GetMapping("/installations/{installationId}/repositories")
    public ResponseEntity<ApiResponse<RepositoriesResponse>> repositories(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @PathVariable long installationId,
            @RequestParam(defaultValue = "1") int page,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return response(service.repositories(principal, installationId, page), requestId);
    }

    private static <T> ResponseEntity<ApiResponse<T>> response(T data, String requestId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate())
                .varyBy("Origin", "Cookie", "Authorization").body(ApiResponse.success(data, requestId));
    }
}
