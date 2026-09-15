package com.codearchive.api.auth;

import java.util.Optional;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;

/** Centralizes the check that an API request is backed by a GitHub login. */
public final class GithubAuthentication {

    private GithubAuthentication() {
    }

    public static Optional<GithubIdentity> identity(Authentication authentication) {
        if (!(authentication instanceof OAuth2AuthenticationToken oauth2)) {
            return Optional.empty();
        }
        if (!"github".equalsIgnoreCase(oauth2.getAuthorizedClientRegistrationId())) {
            return Optional.empty();
        }
        OAuth2User principal = oauth2.getPrincipal();
        Optional<GithubIdentity> identity = GithubIdentity.from(principal);
        if (identity.isEmpty() || !identity.get().githubId().equals(principal.getName())) {
            return Optional.empty();
        }
        return identity;
    }

    public static Optional<String> githubId(Authentication authentication) {
        return identity(authentication).map(GithubIdentity::githubId);
    }
}
