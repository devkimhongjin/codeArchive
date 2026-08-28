package com.codearchive.api.auth.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "codearchive.auth")
public class AuthProperties {

    private final Github github = new Github();
    private Duration sessionTtl = Duration.ofDays(30);
    private Duration stateTtl = Duration.ofMinutes(10);
    private Duration exchangeTtl = Duration.ofMinutes(2);
    private String extensionRedirectUri = "";
    private String dashboardOrigin = "";

    public Github getGithub() {
        return github;
    }

    public Duration getSessionTtl() {
        return sessionTtl;
    }

    public void setSessionTtl(Duration sessionTtl) {
        this.sessionTtl = sessionTtl;
    }

    public Duration getStateTtl() {
        return stateTtl;
    }

    public void setStateTtl(Duration stateTtl) {
        this.stateTtl = stateTtl;
    }

    public Duration getExchangeTtl() {
        return exchangeTtl;
    }

    public void setExchangeTtl(Duration exchangeTtl) {
        this.exchangeTtl = exchangeTtl;
    }

    public String getExtensionRedirectUri() {
        return extensionRedirectUri;
    }

    public void setExtensionRedirectUri(
            String extensionRedirectUri
    ) {
        this.extensionRedirectUri = extensionRedirectUri;
    }

    public String getDashboardOrigin() {
        return dashboardOrigin;
    }

    public void setDashboardOrigin(String dashboardOrigin) {
        this.dashboardOrigin = dashboardOrigin;
    }

    public static class Github {

        private String clientId = "";
        private String clientSecret = "";
        private String callbackUrl =
                "http://localhost:8080/api/v1/auth/github/callback";
        private String authorizeUrl =
                "https://github.com/login/oauth/authorize";
        private String tokenUrl =
                "https://github.com/login/oauth/access_token";
        private String userUrl =
                "https://api.github.com/user";

        public String getClientId() {
            return clientId;
        }

        public void setClientId(String clientId) {
            this.clientId = clientId;
        }

        public String getClientSecret() {
            return clientSecret;
        }

        public void setClientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
        }

        public String getCallbackUrl() {
            return callbackUrl;
        }

        public void setCallbackUrl(String callbackUrl) {
            this.callbackUrl = callbackUrl;
        }

        public String getAuthorizeUrl() {
            return authorizeUrl;
        }

        public void setAuthorizeUrl(String authorizeUrl) {
            this.authorizeUrl = authorizeUrl;
        }

        public String getTokenUrl() {
            return tokenUrl;
        }

        public void setTokenUrl(String tokenUrl) {
            this.tokenUrl = tokenUrl;
        }

        public String getUserUrl() {
            return userUrl;
        }

        public void setUserUrl(String userUrl) {
            this.userUrl = userUrl;
        }
    }
}
