package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class GithubIdentityTest {
    @Test
    void acceptsOnlyGithubHostedHttpsAvatarUrls() {
        GithubIdentity valid = GithubIdentity.fromAttributes(Map.of(
                "id", 42, "login", "octocat",
                "avatar_url", "https://avatars.githubusercontent.com/u/42?v=4")).orElseThrow();
        GithubIdentity invalid = GithubIdentity.fromAttributes(Map.of(
                "id", 43, "login", "other",
                "avatar_url", "https://example.test/tracker.png")).orElseThrow();

        assertThat(valid.avatarUrl()).isEqualTo("https://avatars.githubusercontent.com/u/42?v=4");
        assertThat(invalid.avatarUrl()).isNull();
    }
}
