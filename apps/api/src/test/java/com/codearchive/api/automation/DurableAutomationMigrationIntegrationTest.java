package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Verifies V11 fails closed for rows created before session binding existed. */
@Testcontainers
class DurableAutomationMigrationIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine");

    @Test
    void v11RevokesLegacyRelayAndFencesDurableProfileAndPageRun() {
        var dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        var jdbc = new JdbcTemplate(dataSource);
        Flyway.configure().dataSource(dataSource).target("10").load().migrate();

        UUID user = UUID.randomUUID();
        UUID grant = UUID.randomUUID();
        UUID run = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO users(id,github_user_id,github_login,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                user, Math.abs(UUID.randomUUID().getMostSignificantBits()), "legacy", "Legacy",
                java.sql.Timestamp.from(now), java.sql.Timestamp.from(now));
        jdbc.update("""
                INSERT INTO automation_profiles(user_id,device_id,generation,source_transfer_enabled,
                    github_auto_commit_enabled,ownership_mode,target_generation,target,automatic_transfer_consent,
                    visibility_risk_consent,public_upload_consent,github_enabled_at,version,updated_at)
                VALUES(?,?,?,?,?,?,?,CAST(? AS jsonb),TRUE,TRUE,TRUE,?,?,?)
                """, user, "legacy-device", 7, true, true, "DURABLE_SERVER", 8, "{}",
                java.sql.Timestamp.from(now), 0, java.sql.Timestamp.from(now));
        jdbc.update("""
                INSERT INTO relay_grants(id,user_id,device_id,generation,public_key_hash,token_hash,issued_at,expires_at)
                VALUES(?,?,?,?,?,?,?,?)
                """, grant, user, "legacy-device", 7, "a".repeat(64), "b".repeat(64),
                java.sql.Timestamp.from(now), java.sql.Timestamp.from(now.plusSeconds(3600)));
        jdbc.update("""
                INSERT INTO github_auto_runs(id,user_id,session_id,state,target,enabled_at,lease_until,created_at)
                VALUES(?,?,?,?,CAST(? AS jsonb),?,?,?)
                """, run, user, UUID.randomUUID(), "ACTIVE", "{}", java.sql.Timestamp.from(now),
                java.sql.Timestamp.from(now.plusSeconds(60)), java.sql.Timestamp.from(now));

        Flyway.configure().dataSource(dataSource).load().migrate();

        assertThat(jdbc.queryForObject("SELECT revoked_at IS NOT NULL FROM relay_grants WHERE id=?",
                Boolean.class, grant)).isTrue();
        assertThat(jdbc.queryForMap("SELECT generation,source_transfer_enabled,github_auto_commit_enabled,
                ownership_mode,target,automatic_transfer_consent,visibility_risk_consent,public_upload_consent,
                github_enabled_at,auth_session_id FROM automation_profiles WHERE user_id=?", user))
                .containsEntry("generation", 8L)
                .containsEntry("source_transfer_enabled", false)
                .containsEntry("github_auto_commit_enabled", false)
                .containsEntry("ownership_mode", "PAGE_OWNED")
                .containsEntry("target", null)
                .containsEntry("auth_session_id", null);
        assertThat(jdbc.queryForMap("SELECT state,error_code FROM github_auto_runs WHERE id=?", run))
                .containsEntry("state", "OFF")
                .containsEntry("error_code", "AUTOMATION_OWNERSHIP_CONFLICT");
    }
}
