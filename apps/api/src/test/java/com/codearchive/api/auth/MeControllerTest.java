package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.common.response.ApiResponse;

@ExtendWith(MockitoExtension.class)
class MeControllerTest {

    @Mock
    private AuthService authService;

    @Test
    void meUsesAuthenticatedPrincipalUserOnly() {
        GitHubUserProfile profile =
                new GitHubUserProfile(
                        1001L,
                        "tester",
                        "Tester",
                        "https://example.test/avatar.png"
                );
        CodeArchiveUser user =
                CodeArchiveUser.create(
                        profile,
                        Instant.parse(
                                "2026-08-25T05:47:00Z"
                        )
                );
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        user.getId(),
                        UUID.randomUUID(),
                        "tester"
                );

        when(authService.currentUser(principal))
                .thenReturn(user);

        ApiResponse<MeController.MeResponse> response =
                new MeController(authService)
                        .getMe(
                                principal,
                                "request-123"
                        );

        assertThat(response.success()).isTrue();
        assertThat(response.data().id())
                .isEqualTo(user.getId());
        assertThat(response.data().githubUserId())
                .isEqualTo(1001L);
        assertThat(response.requestId())
                .isEqualTo("request-123");
    }
}
