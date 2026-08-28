package com.codearchive.api.auth.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DashboardOriginValidatorTest {

    @Test
    void acceptsExactHttpsRootOrigin() {
        assertThat(DashboardOriginValidator.normalize(
                "https://codearchive-dashboard-beta.onrender.com"
        )).contains(
                "https://codearchive-dashboard-beta.onrender.com"
        );

        assertThat(DashboardOriginValidator.normalize(
                "https://codearchive-dashboard-beta.onrender.com/"
        )).contains(
                "https://codearchive-dashboard-beta.onrender.com"
        );
    }

    @Test
    void rejectsUnsafeOrUnapprovedOriginValues() {
        assertThat(DashboardOriginValidator.normalize(null))
                .isEmpty();
        assertThat(DashboardOriginValidator.normalize(""))
                .isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "http://codearchive-dashboard-beta.onrender.com"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://*.onrender.com"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://user@codearchive-dashboard-beta.onrender.com"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://codearchive-dashboard-beta.onrender.com/path"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://codearchive-dashboard-beta.onrender.com?x=1"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://codearchive-dashboard-beta.onrender.com#fragment"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://codearchive-dashboard-beta.onrender.com:443"
        )).isEmpty();
        assertThat(DashboardOriginValidator.normalize(
                "https://unapproved.example"
        )).isEmpty();
    }
}
