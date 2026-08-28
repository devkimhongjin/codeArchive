package com.codearchive.api.auth.config;

import java.net.URI;
import java.util.Locale;
import java.util.Optional;

public final class DashboardOriginValidator {

    private DashboardOriginValidator() {
    }

    public static Optional<String> normalize(String configured) {
        if (configured == null || configured.isBlank()) {
            return Optional.empty();
        }

        String candidate = configured.trim();
        if (candidate.contains("*")) {
            return Optional.empty();
        }

        URI uri;
        try {
            uri = URI.create(candidate);
        } catch (IllegalArgumentException exception) {
            return Optional.empty();
        }

        String path = uri.getRawPath();
        boolean rootPath = path == null
                || path.isBlank()
                || "/".equals(path);

        if (!"https".equalsIgnoreCase(uri.getScheme())
                || uri.getHost() == null
                || uri.getHost().isBlank()
                || uri.getUserInfo() != null
                || uri.getPort() != -1
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null
                || !rootPath) {
            return Optional.empty();
        }

        return Optional.of(
                "https://"
                        + uri.getHost().toLowerCase(Locale.ROOT)
        );
    }
}
