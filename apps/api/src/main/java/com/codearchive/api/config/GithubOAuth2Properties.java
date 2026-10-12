package com.codearchive.api.config;

import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "codearchive.github")
public class GithubOAuth2Properties {

    private String clientId = "";
    private String clientSecret = "";
    private String redirectUri = "http://localhost:5173/api/login/oauth2/code/github";
    private String dashboardOrigin = "http://localhost:5173";
    private String extensionApiOrigin = "https://codearchive-api-stg-e3q54l32da-as.a.run.app";

    public boolean isEnabled() {
        return !clientId.isBlank() && !clientSecret.isBlank();
    }

    public String getClientId() {
        return clientId;
    }

    public void setClientId(String clientId) {
        this.clientId = clientId == null ? "" : clientId.trim();
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public void setClientSecret(String clientSecret) {
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
    }

    public String getRedirectUri() {
        return redirectUri;
    }

    public void setRedirectUri(String redirectUri) {
        this.redirectUri = redirectUri == null ? "" : redirectUri.trim();
    }

    public String getDashboardOrigin() {
        return dashboardOrigin;
    }

    public void setDashboardOrigin(String dashboardOrigin) {
        this.dashboardOrigin = dashboardOrigin == null ? "" : dashboardOrigin.trim();
    }
    public String getExtensionApiOrigin() { return extensionApiOrigin; }
    public void setExtensionApiOrigin(String extensionApiOrigin) { this.extensionApiOrigin = extensionApiOrigin == null ? "" : extensionApiOrigin.trim(); }
    public String extensionApiRoot() { return validatedOrigin(extensionApiOrigin, "EXTENSION_API_ORIGIN"); }

    public URI dashboardUri() {
        URI uri;
        try {
            uri = URI.create(dashboardOrigin);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("DASHBOARD_ORIGIN must be an absolute http(s) URL", exception);
        }
        if (uri.getScheme() == null || !("http".equalsIgnoreCase(uri.getScheme())
                || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null
                || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalStateException("DASHBOARD_ORIGIN must be an absolute http(s) URL without query or fragment");
        }
        return uri;
    }

    public String dashboardRoot() {
        String value = dashboardUri().toString();
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public String validatedRedirectUri() {
        URI uri;
        try {
            uri = URI.create(redirectUri);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("GITHUB_REDIRECT_URI must be an absolute http(s) URL", exception);
        }
        if (uri.getScheme() == null || !("http".equalsIgnoreCase(uri.getScheme())
                || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null
                || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalStateException("GITHUB_REDIRECT_URI must be an absolute http(s) URL without query or fragment");
        }
        return uri.toString();
    }
    private static String validatedOrigin(String value, String name) {
        URI uri;
        try { uri = URI.create(value); } catch (IllegalArgumentException exception) { throw new IllegalStateException(name + " must be an absolute https URL", exception); }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawQuery() != null || uri.getRawFragment() != null) throw new IllegalStateException(name + " must be an absolute https URL without query or fragment");
        String result = uri.toString(); return result.endsWith("/") ? result.substring(0, result.length() - 1) : result;
    }
}
