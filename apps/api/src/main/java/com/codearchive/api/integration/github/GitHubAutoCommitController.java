package com.codearchive.api.integration.github;

import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1/integrations/github/auto-commit")
public class GitHubAutoCommitController {
    private final GitHubAutoCommitService service;
    public GitHubAutoCommitController(GitHubAutoCommitService service) { this.service=service; }
    @GetMapping public ResponseEntity<?> current(@AuthenticationPrincipal CodeArchivePrincipal p,@RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) { return response(service.status(p,null),requestId); }
    @GetMapping("/{id}") public ResponseEntity<?> status(@AuthenticationPrincipal CodeArchivePrincipal p,@PathVariable UUID id,@RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) { return response(service.status(p,id),requestId); }
    @PostMapping("/{id}/enable") public ResponseEntity<?> enable(@AuthenticationPrincipal CodeArchivePrincipal p,@PathVariable UUID id,@RequestBody GitHubAutoCommitService.Enable request,@RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) { return response(service.enable(p,id,request),requestId); }
    @PostMapping("/{id}/stop") public ResponseEntity<?> stop(@AuthenticationPrincipal CodeArchivePrincipal p,@PathVariable UUID id,@RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) { return response(service.stop(p,id),requestId); }
    @PostMapping("/{id}/tick") public ResponseEntity<?> tick(@AuthenticationPrincipal CodeArchivePrincipal p,@PathVariable UUID id,@RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) { return response(service.tick(p,id),requestId); }
    private ResponseEntity<?> response(Object data,String requestId) { return ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate()).varyBy("Origin","Cookie","Authorization").body(ApiResponse.success(data,requestId)); }
}
