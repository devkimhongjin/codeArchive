package com.codearchive.api.config;

import javax.sql.DataSource;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Relaxes only the two old credential columns so an existing local database
 * can accept a GitHub-only row. Existing values and the legacy email unique
 * constraint remain untouched; email is not used to link accounts.
 */
@Component
@Profile({"local", "test"})
public class LegacyUserSchemaMigration implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    public LegacyUserSchemaMigration(DataSource dataSource) {
        this.jdbcTemplate = new JdbcTemplate(dataSource);
    }

    @Override
    public void run(ApplicationArguments args) {
        relaxColumn("email");
        relaxColumn("password_hash");
    }

    private void relaxColumn(String column) {
        // Supported H2 profiles accept this idempotent statement. A failure
        // must stop startup rather than surface later as a broken OAuth login.
        jdbcTemplate.execute("ALTER TABLE users ALTER COLUMN " + column + " DROP NOT NULL");
    }
}
