package com.codearchive.api.auth;

import java.net.URI;
import java.util.Map;
import java.util.Optional;
import org.springframework.security.oauth2.core.user.OAuth2User;

/**
 * The small, provider-specific identity contract used by the API.
 *
 * GitHub's numeric {@code id} is the only account key.  Login, display name,
 * and email are profile fields and can change or be unavailable.
 */
public record GithubIdentity(String githubId, String githubLogin, String name, String email, String avatarUrl) {

    public GithubIdentity(String githubId, String githubLogin, String name, String email) {
        this(githubId, githubLogin, name, email, null);
    }

    public static Optional<GithubIdentity> from(OAuth2User principal) {
        if (principal == null) {
            return Optional.empty();
        }
        return fromAttributes(principal.getAttributes());
    }

    public static Optional<GithubIdentity> fromAttributes(Map<String, Object> attributes) {
        if (attributes == null) {
            return Optional.empty();
        }
        String githubId = numericId(attributes.get("id"));
        String login = text(attributes.get("login"));
        if (githubId == null || login == null) {
            return Optional.empty();
        }
        return Optional.of(new GithubIdentity(
                githubId,
                login,
                optionalText(attributes.get("name")),
                optionalText(attributes.get("email")),
                githubAvatarUrl(attributes.get("avatar_url"))));
    }

    private static String numericId(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.matches("[0-9]+") ? text : null;
    }

    private static String text(Object value) {
        String text = optionalText(value);
        return text == null ? null : text;
    }

    private static String optionalText(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    private static String githubAvatarUrl(Object value) {
        String text = optionalText(value);
        if (text == null || text.length() > 2048) return null;
        try {
            URI uri = URI.create(text);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && "avatars.githubusercontent.com".equalsIgnoreCase(uri.getHost()) ? text : null;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }
}
