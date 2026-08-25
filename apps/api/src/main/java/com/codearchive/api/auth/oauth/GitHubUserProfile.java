package com.codearchive.api.auth.oauth;

public record GitHubUserProfile(
        long githubUserId,
        String githubLogin,
        String displayName,
        String avatarUrl
) {
}
