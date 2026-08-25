package com.codearchive.api.auth.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.codearchive.api.auth.oauth.GitHubUserProfile;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    private static final Instant NOW =
            Instant.parse("2026-08-25T05:47:00Z");

    @Mock
    private UserRepository userRepository;

    private UserService userService;

    @BeforeEach
    void setUp() {
        userService = new UserService(
                userRepository,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void sameGithubUserReloginKeepsOneUserIdentity() {
        GitHubUserProfile firstProfile =
                new GitHubUserProfile(
                        1001L,
                        "tester",
                        "Tester",
                        "https://example.test/a.png"
                );
        GitHubUserProfile refreshedProfile =
                new GitHubUserProfile(
                        1001L,
                        "tester-renamed",
                        "Tester Updated",
                        "https://example.test/b.png"
                );

        AtomicReference<CodeArchiveUser> stored =
                new AtomicReference<>();

        when(userRepository.findByGithubUserId(1001L))
                .thenAnswer(invocation ->
                        Optional.ofNullable(stored.get())
                );
        when(userRepository.saveAndFlush(any()))
                .thenAnswer(invocation -> {
                    CodeArchiveUser user =
                            invocation.getArgument(0);
                    stored.set(user);
                    return user;
                });
        when(userRepository.save(any()))
                .thenAnswer(invocation ->
                        invocation.getArgument(0)
                );

        CodeArchiveUser first =
                userService.upsert(firstProfile);
        CodeArchiveUser second =
                userService.upsert(refreshedProfile);

        assertThat(second.getId()).isEqualTo(first.getId());
        assertThat(second.getGithubUserId()).isEqualTo(1001L);
        assertThat(second.getGithubLogin())
                .isEqualTo("tester-renamed");
        verify(userRepository, times(1))
                .saveAndFlush(any());
    }

    @Test
    void differentGithubUsersReceiveDifferentCodeArchiveUsers() {
        when(userRepository.findByGithubUserId(
                org.mockito.ArgumentMatchers.anyLong()
        )).thenReturn(Optional.empty());
        when(userRepository.saveAndFlush(any()))
                .thenAnswer(invocation ->
                        invocation.getArgument(0)
                );

        CodeArchiveUser first = userService.upsert(
                new GitHubUserProfile(
                        1001L,
                        "alpha",
                        null,
                        null
                )
        );
        CodeArchiveUser second = userService.upsert(
                new GitHubUserProfile(
                        2002L,
                        "beta",
                        null,
                        null
                )
        );

        assertThat(first.getId())
                .isNotEqualTo(second.getId());
        assertThat(first.getGithubUserId())
                .isNotEqualTo(second.getGithubUserId());
        verify(userRepository, times(2))
                .saveAndFlush(any());
    }
}
