package com.codearchive.api.auth;

import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Creates or refreshes the local profile for a verified GitHub OAuth user. */
@Service
public class GithubAccountService {

    private final UserRepository userRepository;

    public GithubAccountService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional
    public AppUser upsert(OAuth2User principal) {
        GithubIdentity identity = GithubIdentity.from(principal)
                .orElseThrow(() -> new IllegalArgumentException("GitHub identity is incomplete"));
        AppUser user = userRepository.findByGithubId(identity.githubId())
                .orElseGet(() -> AppUser.fromGithub(identity.githubId(), identity.githubLogin(), identity.name(), identity.email(), identity.avatarUrl()));
        if (user.getGithubId() == null || !user.getGithubId().equals(identity.githubId())) {
            throw new IllegalStateException("GitHub identity cannot be changed");
        }
        user.updateGithubProfile(identity.githubLogin(), identity.name(), identity.email(), identity.avatarUrl());
        return userRepository.save(user);
    }

    @Transactional(readOnly = true)
    public AppUser findByGithubId(String githubId) {
        return userRepository.findByGithubId(githubId).orElse(null);
    }
}
