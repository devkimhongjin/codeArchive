package com.codearchive.api.auth.config;

import java.net.URI;
import java.util.Locale;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.Optional;

public final class DashboardOriginValidator {

    private static final String APPROVED_BETA_DASHBOARD_ORIGIN =
            "https://codearchive-dashboard-beta.onrender.com";
    private static final String APPROVED_NETLIFY_BETA_DASHBOARD_ORIGIN =
            "https://codearchive-dashboard-beta.netlify.app";

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

        String normalized = "https://"
                + uri.getHost().toLowerCase(Locale.ROOT);
        if (!APPROVED_BETA_DASHBOARD_ORIGIN.equals(normalized)) {
            if (!APPROVED_NETLIFY_BETA_DASHBOARD_ORIGIN.equals(normalized)) {
                return Optional.empty();
            }
        }

        return Optional.of(normalized);
    }

    public static Set<String> normalizeAllowed(String configured) {
        if (configured == null || configured.isBlank()) {
            return Set.of();
        }

        Set<String> normalized = new LinkedHashSet<>();
        for (String value : configured.split(",", -1)) {
            Optional<String> origin = normalize(value.trim());
            if (origin.isEmpty()) {
                return Set.of();
            }
            normalized.add(origin.get());
        }
        return Set.copyOf(normalized);
    }
}
