package com.codearchive.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Properties;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaVendorAdapter;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;

/**
 * PostgreSQL-only migration coverage. Run with PG_TEST_URL, PG_TEST_USER, and
 * PG_TEST_PASSWORD set; without those variables the class is skipped so the
 * normal H2 test suite remains self-contained.
 */
class PostgreSqlMigrationTest {

    @Test
    void freshSchemaMigratesTwiceAndPassesHibernateValidation() throws Exception {
        TestDatabase database = TestDatabase.create();
        try {
            Flyway flyway = database.flyway();

            MigrateResult first = flyway.migrate();
            assertEquals(3, first.migrationsExecuted);
            assertEquals(3, database.historyCount());

            MigrateResult second = flyway.migrate();
            assertEquals(0, second.migrationsExecuted);
            assertEquals(3, database.historyCount());

            database.assertFinalSchema();
            validateWithHibernate(database);
        } finally {
            database.drop();
        }
    }

    @Test
    void legacyRowsSurviveExplicitV1BaselineAndV2Upgrade() throws Exception {
        TestDatabase database = TestDatabase.create();
        try {
            Flyway v1 = database.flyway(MigrationVersion.fromVersion("1"));
            assertEquals(1, v1.migrate().migrationsExecuted);

            long userId = database.insertLegacyRows();
            database.dropHistory();

            Flyway adopted = database.flyway();
            assertThrows(FlywayException.class, adopted::migrate);
            adopted.baseline();
            assertEquals(1, database.historyCount());
            assertEquals(2, adopted.migrate().migrationsExecuted);

            assertEquals("legacy@example.com", database.scalar(
                    "SELECT email FROM users WHERE id = ?", userId));
            assertEquals("legacy-hash", database.scalar(
                    "SELECT password_hash FROM users WHERE id = ?", userId));
            assertEquals(1L, ((Number) database.scalar(
                    "SELECT COUNT(*) FROM solutions WHERE user_id = ?", userId)).longValue());
            database.assertFinalSchema();
            validateWithHibernate(database);
        } finally {
            database.drop();
        }
    }

    @Test
    void currentGithubSchemaCanBeExplicitlyBaselinedAtV2() throws Exception {
        TestDatabase database = TestDatabase.create();
        try {
            Flyway current = database.flyway(MigrationVersion.fromVersion("2"));
            assertEquals(2, current.migrate().migrationsExecuted);
            long userId = database.insertGithubRows();
            database.dropHistory();

            Flyway adopted = database.flywayAtBaseline(MigrationVersion.fromVersion("2"));
            adopted.baseline();
            assertEquals(1, database.historyCount());
            assertEquals(1, adopted.migrate().migrationsExecuted);

            assertEquals("9001", database.scalar(
                    "SELECT github_id FROM users WHERE id = ?", userId));
            assertEquals(1L, ((Number) database.scalar(
                    "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? "
                            + "AND indexname = 'idx_solutions_user_solved_at'", database.schema)).longValue());
            validateWithHibernate(database);
        } finally {
            database.drop();
        }
    }

    private static void validateWithHibernate(TestDatabase database) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.postgresql.Driver");
        dataSource.setUrl(database.url);
        dataSource.setUsername(database.user);
        dataSource.setPassword(database.password);

        LocalContainerEntityManagerFactoryBean entityManagerFactory =
                new LocalContainerEntityManagerFactoryBean();
        entityManagerFactory.setDataSource(dataSource);
        entityManagerFactory.setPackagesToScan("com.codearchive.api.auth", "com.codearchive.api.solution");
        JpaVendorAdapter vendorAdapter = new HibernateJpaVendorAdapter();
        entityManagerFactory.setJpaVendorAdapter(vendorAdapter);
        Properties properties = new Properties();
        properties.put("hibernate.hbm2ddl.auto", "validate");
        properties.put("hibernate.default_schema", database.schema);
        properties.put("hibernate.jdbc.time_zone", "UTC");
        entityManagerFactory.setJpaProperties(properties);

        try {
            entityManagerFactory.afterPropertiesSet();
        } finally {
            entityManagerFactory.destroy();
        }
    }

    private static final class TestDatabase {
        private final String url;
        private final String user;
        private final String password;
        private final String schema;

        private TestDatabase(String url, String user, String password, String schema) {
            this.url = url;
            this.user = user;
            this.password = password;
            this.schema = schema;
        }

        private static TestDatabase create() throws SQLException {
            String url = requiredEnvironment("PG_TEST_URL");
            String user = requiredEnvironment("PG_TEST_USER");
            String password = requiredEnvironment("PG_TEST_PASSWORD");
            String schema = "migration_test_" + UUID.randomUUID().toString().replace('-', '_');
            TestDatabase database = new TestDatabase(url, user, password, schema);
            try (Connection connection = DriverManager.getConnection(url, user, password);
                    Statement statement = connection.createStatement()) {
                statement.execute("CREATE SCHEMA " + quoteIdentifier(schema));
            }
            return database;
        }

        private static String requiredEnvironment(String name) {
            String value = System.getenv(name);
            Assumptions.assumeTrue(value != null && !value.isBlank(),
                    "Set " + name + " to run the PostgreSQL migration tests");
            return value;
        }

        private Flyway flyway() {
            return flyway(null, null);
        }

        private Flyway flyway(MigrationVersion target) {
            return flyway(target, null);
        }

        private Flyway flywayAtBaseline(MigrationVersion baselineVersion) {
            return flyway(null, baselineVersion);
        }

        private Flyway flyway(MigrationVersion target, MigrationVersion baselineVersion) {
            var configuration = Flyway.configure()
                    .dataSource(url, user, password)
                    .locations("classpath:db/migration")
                    .schemas(schema)
                    .defaultSchema(schema)
                    .baselineOnMigrate(false)
                    .cleanDisabled(true)
                    .validateOnMigrate(true);
            if (baselineVersion != null) {
                configuration.baselineVersion(baselineVersion);
            }
            if (target != null) {
                configuration.target(target);
            }
            return configuration.load();
        }

        private Connection connection() throws SQLException {
            Connection connection = DriverManager.getConnection(url, user, password);
            connection.setSchema(schema);
            return connection;
        }

        private long historyCount() throws SQLException {
            Number count = scalar("SELECT COUNT(*) FROM flyway_schema_history");
            return count.longValue();
        }

        private long insertLegacyRows() throws SQLException {
            return insertUser(null, null, null, null);
        }

        private long insertGithubRows() throws SQLException {
            return insertUser("9001", "octocat", "Octo", "octo@example.com");
        }

        private long insertUser(String githubId, String githubLogin, String githubName, String githubEmail)
                throws SQLException {
            long userId;
            String sql = githubId == null
                    ? "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id"
                    : "INSERT INTO users (github_id, github_login, github_name, github_email, created_at) "
                            + "VALUES (?, ?, ?, ?, ?) RETURNING id";
            try (Connection connection = connection(); PreparedStatement userStatement = connection.prepareStatement(sql)) {
                if (githubId == null) {
                    userStatement.setString(1, "legacy@example.com");
                    userStatement.setString(2, "legacy-hash");
                    userStatement.setObject(3, utc("2025-01-02T03:04:05Z"));
                } else {
                    userStatement.setString(1, githubId);
                    userStatement.setString(2, githubLogin);
                    userStatement.setString(3, githubName);
                    userStatement.setString(4, githubEmail);
                    userStatement.setObject(5, utc("2025-01-02T03:04:05Z"));
                }
                try (ResultSet resultSet = userStatement.executeQuery()) {
                    assertTrue(resultSet.next());
                    userId = resultSet.getLong(1);
                }
            }
            try (Connection connection = connection();
                    PreparedStatement solutionStatement = connection.prepareStatement(
                            "INSERT INTO solutions (user_id, capture_id, platform, problem_number, title, "
                                    + "problem_url, language, source_code, result, observed_at, solved_at, "
                                    + "execution_time, memory_usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                solutionStatement.setLong(1, userId);
                solutionStatement.setString(2, UUID.randomUUID().toString());
                solutionStatement.setString(3, "SWEA");
                solutionStatement.setString(4, "1234");
                solutionStatement.setString(5, "Legacy problem");
                solutionStatement.setString(6, "https://swexpertacademy.com/problem/1234");
                solutionStatement.setString(7, "JAVA");
                solutionStatement.setString(8, "class Main {}");
                solutionStatement.setString(9, "ACCEPTED");
                solutionStatement.setObject(10, utc("2025-01-02T03:04:05Z"));
                solutionStatement.setObject(11, utc("2025-01-02T03:04:05Z"));
                solutionStatement.setBigDecimal(12, new BigDecimal("1.250000"));
                solutionStatement.setBigDecimal(13, new BigDecimal("64.000000"));
                solutionStatement.executeUpdate();
            }
            return userId;
        }

        private void assertFinalSchema() throws SQLException {
            assertEquals("YES", nullable("users", "email"));
            assertEquals("YES", nullable("users", "password_hash"));
            assertEquals("YES", nullable("users", "github_id"));
            assertEquals("YES", nullable("users", "github_login"));
            assertEquals("YES", nullable("users", "github_name"));
            assertEquals("YES", nullable("users", "github_email"));
            assertEquals("NO", nullable("users", "created_at"));
            assertEquals("NO", nullable("solutions", "user_id"));
            assertEquals("NO", nullable("solutions", "capture_id"));
            assertEquals("NO", nullable("solutions", "source_code"));
            assertEquals("users", scalar(
                    "SELECT table_name FROM information_schema.tables "
                            + "WHERE table_schema = ? AND table_name = 'users'", schema));
            assertEquals(1L, ((Number) scalar(
                    "SELECT COUNT(*) FROM pg_constraint c "
                            + "JOIN pg_namespace n ON n.oid = c.connamespace "
                            + "WHERE n.nspname = ? AND c.conname = 'uk_users_github_id'", schema)).longValue());
            assertEquals(1L, ((Number) scalar(
                    "SELECT COUNT(*) FROM pg_constraint c "
                            + "JOIN pg_namespace n ON n.oid = c.connamespace "
                            + "WHERE n.nspname = ? AND c.conname = 'fk_solution_user'", schema)).longValue());
            assertEquals(1L, ((Number) scalar(
                    "SELECT COUNT(*) FROM pg_indexes "
                            + "WHERE schemaname = ? AND indexname = 'idx_solutions_user_solved_at'", schema)).longValue());
        }

        private String nullable(String table, String column) throws SQLException {
            return scalar("SELECT is_nullable FROM information_schema.columns "
                    + "WHERE table_schema = ? AND table_name = ? AND column_name = ?", schema, table, column);
        }

        private <T> T scalar(String sql, Object... parameters) throws SQLException {
            try (Connection connection = connection(); PreparedStatement statement = connection.prepareStatement(sql)) {
                for (int index = 0; index < parameters.length; index++) {
                    statement.setObject(index + 1, parameters[index]);
                }
                try (ResultSet resultSet = statement.executeQuery()) {
                    assertTrue(resultSet.next(), "Expected a row for: " + sql);
                    @SuppressWarnings("unchecked")
                    T value = (T) resultSet.getObject(1);
                    return value;
                }
            }
        }

        private void dropHistory() throws SQLException {
            try (Connection connection = connection(); Statement statement = connection.createStatement()) {
                statement.execute("DROP TABLE " + quoteIdentifier(schema) + ".flyway_schema_history");
            }
        }

        private void drop() throws SQLException {
            try (Connection connection = connection(); Statement statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA IF EXISTS " + quoteIdentifier(schema) + " CASCADE");
            }
        }

        private static String quoteIdentifier(String identifier) {
            return '"' + identifier.replace("\"", "\"\"") + '"';
        }

        private static OffsetDateTime utc(String value) {
            return Instant.parse(value).atOffset(ZoneOffset.UTC);
        }
    }
}
