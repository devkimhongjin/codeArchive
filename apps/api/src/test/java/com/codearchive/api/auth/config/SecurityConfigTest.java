package com.codearchive.api.auth.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SecurityConfigTest {

    @Test
    void malformedNonBlankAllowListFailsClosedInsteadOfFallingBack() {
        assertThat(SecurityConfig.dashboardOrigins(
                "https://codearchive-dashboard-beta.onrender.com",
                "https://codearchive-dashboard-beta.netlify.app,https://unapproved.example"
        )).isEmpty();
    }

    @Test
    void blankAllowListPreservesCanonicalOriginFallback() {
        assertThat(SecurityConfig.dashboardOrigins(
                "https://codearchive-dashboard-beta.onrender.com",
                ""
        )).containsExactly(
                "https://codearchive-dashboard-beta.onrender.com"
        );
    }
}
