package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.SQLException;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class OAuthStateMigrationIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17-alpine");

    @Test
    void upgradesV5PreservingRowsAndAllowsOnlySupportedFlows() {
        var dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        );
        var jdbc = new JdbcTemplate(dataSource);
        Flyway.configure().dataSource(dataSource).target("5").load().migrate();

        insertState(jdbc, "GENERIC");
        insertState(jdbc, "EXTENSION");
        var existingRows = jdbc.queryForList("SELECT * FROM oauth_states ORDER BY id");
        assertRejectedFlow(jdbc, "DASHBOARD");

        var latest = Flyway.configure().dataSource(dataSource).load();
        latest.migrate();
        latest.validate();

        assertThat(jdbc.queryForList("SELECT * FROM oauth_states ORDER BY id"))
                .isEqualTo(existingRows);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE version = '6' AND success",
                Integer.class
        )).isEqualTo(1);

        for (String flow : new String[] {"GENERIC", "EXTENSION", "DASHBOARD"}) {
            insertState(jdbc, flow);
        }
        assertThat(jdbc.queryForList("SELECT flow_type FROM oauth_states", String.class))
                .containsExactlyInAnyOrder("GENERIC", "EXTENSION", "GENERIC", "EXTENSION", "DASHBOARD");
        assertRejectedFlow(jdbc, "UNKNOWN");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM oauth_states", Integer.class))
                .isEqualTo(5);
    }

    private static void insertState(JdbcTemplate jdbc, String flow) {
        jdbc.update(
                "INSERT INTO oauth_states (id, state_hash, flow_type, expires_at, created_at) "
                        + "VALUES (?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '5 minutes', CURRENT_TIMESTAMP)",
                UUID.randomUUID(), UUID.randomUUID().toString().replace("-", "").repeat(2), flow
        );
    }

    private static void assertRejectedFlow(JdbcTemplate jdbc, String flow) {
        assertThatThrownBy(() -> insertState(jdbc, flow))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(((SQLException) error.getCause()).getSQLState())
                        .isEqualTo("23514"));
    }
}
