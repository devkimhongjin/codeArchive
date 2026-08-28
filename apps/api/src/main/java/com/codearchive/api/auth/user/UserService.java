package com.codearchive.api.auth.user;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final Clock clock;

    @Autowired
    public UserService(UserRepository userRepository) {
        this(userRepository, Clock.systemUTC());
    }

    UserService(
            UserRepository userRepository,
            Clock clock
    ) {
        this.userRepository = userRepository;
        this.clock = clock;
    }

    @Transactional
    public CodeArchiveUser upsert(GitHubUserProfile profile) {
        validate(profile);

        Instant now = clock.instant();

        return userRepository.findByGithubUserId(
                        profile.githubUserId()
                )
                .map(existing -> {
                    existing.refresh(profile, now);
                    return userRepository.save(existing);
                })
                .orElseGet(() ->
                        userRepository.saveAndFlush(
                                CodeArchiveUser.create(
                                        profile,
                                        now
                                )
                        )
                );
    }

    @Transactional(readOnly = true)
    public CodeArchiveUser getById(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new CodeArchiveException(
                        ErrorCode.AUTH_REQUIRED
                ));
    }

    private void validate(GitHubUserProfile profile) {
        if (profile == null
                || profile.githubUserId() <= 0
                || profile.githubLogin() == null
                || profile.githubLogin().isBlank()) {
            throw new CodeArchiveException(
                    ErrorCode.EXTERNAL_API_ERROR
            );
        }
    }
}
