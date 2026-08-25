package com.codearchive.api.auth;

import java.util.UUID;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1")
public class MeController {

    private final AuthService authService;

    public MeController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/me")
    public ApiResponse<MeResponse> getMe(
            @AuthenticationPrincipal
            CodeArchivePrincipal principal,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        CodeArchiveUser user =
                authService.currentUser(principal);

        return ApiResponse.success(
                new MeResponse(
                        user.getId(),
                        user.getGithubUserId(),
                        user.getGithubLogin(),
                        user.getDisplayName(),
                        user.getAvatarUrl()
                ),
                requestId
        );
    }

    public record MeResponse(
            UUID id,
            long githubUserId,
            String githubLogin,
            String displayName,
            String avatarUrl
    ) {
    }
}
