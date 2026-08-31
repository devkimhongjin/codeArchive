package com.codearchive.api.integration.github;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1/integrations/github")
public class GitHubUploadPreviewController {
    private final GitHubUploadPreviewService service;
    public GitHubUploadPreviewController(GitHubUploadPreviewService service) { this.service = service; }

    @PostMapping("/upload-preview")
    public ResponseEntity<ApiResponse<GitHubUploadPreviewService.Preview>> preview(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestBody GitHubUploadPreviewService.Request request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate())
                .varyBy("Origin", "Cookie", "Authorization")
                .body(ApiResponse.success(service.preview(principal, request), requestId));
    }
}
