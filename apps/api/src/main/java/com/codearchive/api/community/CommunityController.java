package com.codearchive.api.community;

import java.util.UUID;
import java.time.Instant;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

@RestController
@RequestMapping("/api/v1/community")
@Validated
public class CommunityController {
    private final CommunityService service;
    public CommunityController(CommunityService service) { this.service = service; }

    @ModelAttribute
    void noStore(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store, private");
        response.setHeader("Vary", "Origin, Cookie, Authorization");
    }
    public record Visibility(@NotNull Boolean publicSolution, Instant expectedUpdatedAt) {}
    public record Body(@NotBlank @Size(max = 2000) String body) {}
    public record Like(@NotNull Boolean liked) {}
    public record Report(@NotNull @Pattern(regexp = "SPAM|ABUSE|SENSITIVE") String reason) {}
    public record Done(boolean saved) {}

    @GetMapping("/sharing/{id}")
    public ApiResponse<CommunityService.Sharing> sharing(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.sharing(user, id), requestId);
    }
    @PostMapping("/sharing/{id}")
    public ApiResponse<CommunityService.Sharing> publish(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @Valid @RequestBody Visibility body,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.publish(user, id, body.publicSolution(), body.expectedUpdatedAt()), requestId);
    }
    @GetMapping("/peers/{anchor}")
    public ApiResponse<CommunityService.Page<CommunityService.SharedSolution>> peers(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID anchor, @RequestParam(defaultValue = "") @Size(max = 64) String language,
            @RequestParam(defaultValue = "0") @Min(0) @Max(10000) int offset,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.peers(user, anchor, language.strip(), offset), requestId);
    }
    @GetMapping("/solutions/{id}")
    public ApiResponse<CommunityService.SharedSolution> detail(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.detail(user, id), requestId);
    }
    @GetMapping("/solutions/{id}/comments")
    public ApiResponse<CommunityService.Page<CommunityService.Comment>> comments(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @RequestParam(defaultValue = "0") @Min(0) @Max(10000) int offset,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.comments(user, id, offset), requestId);
    }
    @PostMapping("/solutions/{id}/comments")
    public ApiResponse<CommunityService.Comment> addComment(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @Valid @RequestBody Body body,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.addComment(user, id, body.body()), requestId);
    }
    @PostMapping("/solutions/{id}/comments/{comment}")
    public ApiResponse<CommunityService.Comment> editComment(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @PathVariable UUID comment, @Valid @RequestBody Body body,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        return ApiResponse.success(service.editComment(user, id, comment, body.body()), requestId);
    }
    @DeleteMapping("/solutions/{id}/comments/{comment}")
    public ApiResponse<Done> deleteComment(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @PathVariable UUID comment,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        service.deleteComment(user, id, comment);
        return ApiResponse.success(new Done(true), requestId);
    }
    @PostMapping("/solutions/{id}/like")
    public ApiResponse<Done> like(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @Valid @RequestBody Like body,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        service.like(user, id, body.liked());
        return ApiResponse.success(new Done(true), requestId);
    }
    @PostMapping("/solutions/{id}/report")
    public ApiResponse<Done> report(@AuthenticationPrincipal CodeArchivePrincipal user,
            @PathVariable UUID id, @Valid @RequestBody Report body,
            @RequestAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE) String requestId) {
        service.report(user, id, body.reason());
        return ApiResponse.success(new Done(true), requestId);
    }
}
