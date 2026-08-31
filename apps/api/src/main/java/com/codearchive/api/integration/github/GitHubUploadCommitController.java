package com.codearchive.api.integration.github;

import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1/integrations/github/upload-intents")
public class GitHubUploadCommitController {
    private final GitHubUploadCommitService service;
    public GitHubUploadCommitController(GitHubUploadCommitService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<?> prepare(@AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestBody GitHubUploadPreviewService.Request request,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return response(service.prepare(principal, request), requestId);
    }
    @PostMapping("/{id}/commit")
    public ResponseEntity<?> commit(@AuthenticationPrincipal CodeArchivePrincipal principal, @PathVariable UUID id,
            @RequestBody GitHubUploadCommitService.Consent consent,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return response(service.commit(principal, id, consent), requestId);
    }
    @GetMapping("/{id}")
    public ResponseEntity<?> status(@AuthenticationPrincipal CodeArchivePrincipal principal, @PathVariable UUID id,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return response(service.status(principal, id), requestId);
    }
    private ResponseEntity<?> response(Object data, String requestId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate()).varyBy("Origin", "Cookie", "Authorization")
                .body(ApiResponse.success(data, requestId));
    }
}
