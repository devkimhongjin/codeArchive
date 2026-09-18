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
    private static final int LATEST_MIGRATION = 12;

    @Test
    void freshSchemaMigratesTwiceAndPassesHibernateValidation() throws Exception {
        TestDatabase database = TestDatabase.create();
        try {
            Flyway flyway = database.flyway();

            MigrateResult first = flyway.migrate();
            assertEquals(LATEST_MIGRATION, first.migrationsExecuted);
            assertEquals(LATEST_MIGRATION, database.historyCount());

            MigrateResult second = flyway.migrate();
            assertEquals(0, second.migrationsExecuted);
            assertEquals(LATEST_MIGRATION, database.historyCount());

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
            assertEquals(LATEST_MIGRATION - 1, adopted.migrate().migrationsExecuted);

            assertEquals("legacy@example.com", database.scalar(
                    "SELECT email FROM users WHERE id = ?", userId));
            assertEquals("legacy-hash", database.scalar(
                    "SELECT password_hash FROM users WHERE id = ?", userId));
            assertEquals(1L, ((Number) database.scalar(
                    "SELECT COUNT(*) FROM solutions WHERE user_id = ?", userId)).longValue());
            assertEquals("java", database.scalar(
                    "SELECT language_key FROM solutions WHERE user_id = ?", userId));
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
            assertEquals(LATEST_MIGRATION - 2, adopted.migrate().migrationsExecuted);

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

    @Test
    void prodSchemaImportsLegacyPublicRowsWithoutChangingThePublicSource() throws Exception {
        requirePublicSchemaMutation();
        TestDatabase database = TestDatabase.create();
        try {
            database.createLegacyProductionSource();
            assertEquals(1L, database.publicCount("flyway_schema_history"));
            assertEquals(2L, database.publicCount("users"));
            assertEquals(57L, database.publicCount("solutions"));

            assertEquals(LATEST_MIGRATION, database.prodFlyway().migrate().migrationsExecuted);
            assertEquals(LATEST_MIGRATION, database.versionedHistoryCount("codearchive_v2"));
            assertEquals(2L, database.countInSchema("codearchive_v2", "users"));
            assertEquals(57L, database.countInSchema("codearchive_v2", "solutions"));
            assertEquals("101.000000", database.scalarInSchema("codearchive_v2",
                    "SELECT execution_time::text FROM solutions WHERE problem_number = '1000'"));
            assertEquals("101164.000000", database.scalarInSchema("codearchive_v2",
                    "SELECT memory_usage::text FROM solutions WHERE problem_number = '1000'"));
            assertEquals("java", database.scalarInSchema("codearchive_v2",
                    "SELECT language_key FROM solutions WHERE problem_number = '1000'"));
            assertEquals("https://school.programmers.co.kr/learn/courses/30/lessons/1000",
                    database.scalarInSchema("codearchive_v2",
                            "SELECT problem_url FROM solutions WHERE problem_number = '1000'"));
            assertEquals("https://swexpertacademy.com/main/code/problem/problemList.do",
                    database.scalarInSchema("codearchive_v2",
                            "SELECT problem_url FROM solutions WHERE problem_number = '1001'"));
            assertEquals(1L, database.publicCount("flyway_schema_history"));
            assertEquals(2L, database.publicCount("users"));
            assertEquals(57L, database.publicCount("solutions"));
            assertEquals(0, database.prodFlyway().migrate().migrationsExecuted);
        } finally {
            database.dropProductionSchemas();
            database.drop();
        }
    }

    @Test
    void prodSchemaSkipsAnAlreadyRebuiltPublicShape() throws Exception {
        requirePublicSchemaMutation();
        TestDatabase database = TestDatabase.create();
        try {
            database.createRebuiltPublicSource();
            assertEquals(LATEST_MIGRATION, database.prodFlyway().migrate().migrationsExecuted);
            assertEquals(0L, database.countInSchema("codearchive_v2", "users"));
            assertEquals(0L, database.countInSchema("codearchive_v2", "solutions"));
            assertEquals(0, database.prodFlyway().migrate().migrationsExecuted);
        } finally {
            database.dropProductionSchemas();
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
        entityManagerFactory.setPackagesToScan("com.codearchive.api.auth", "com.codearchive.api.solution", "com.codearchive.api.settings", "com.codearchive.api.relay", "com.codearchive.api.automation");
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

    private static void requirePublicSchemaMutation() {
        Assumptions.assumeTrue("true".equals(System.getenv("PG_TEST_ALLOW_PUBLIC_SCHEMA_MUTATION")),
                "Set PG_TEST_ALLOW_PUBLIC_SCHEMA_MUTATION=true to run tests that mutate public");
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

        private Flyway prodFlyway() {
            return Flyway.configure()
                    .dataSource(url, user, password)
                    .locations("classpath:db/migration")
                    .schemas("codearchive_v2")
                    .defaultSchema("codearchive_v2")
                    .createSchemas(true)
                    .baselineOnMigrate(false)
                    .cleanDisabled(true)
                    .validateOnMigrate(true)
                    .load();
        }

        private Connection connection() throws SQLException {
            return connection(schema);
        }

        private Connection connection(String targetSchema) throws SQLException {
            Connection connection = DriverManager.getConnection(url, user, password);
            connection.setSchema(targetSchema);
            return connection;
        }

        private void createLegacyProductionSource() throws SQLException {
            try (Connection connection = connection("public"); Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE flyway_schema_history (installed_rank INT PRIMARY KEY, version VARCHAR(50), description VARCHAR(200), type VARCHAR(20), script VARCHAR(1000), checksum INT, installed_by VARCHAR(100), installed_on TIMESTAMPTZ DEFAULT now(), execution_time INT, success BOOLEAN)");
                statement.execute("INSERT INTO flyway_schema_history (installed_rank, version, description, type, script, execution_time, success) VALUES (1, '12', 'legacy history', 'SQL', 'V12__legacy.sql', 1, true)");
                statement.execute("CREATE TABLE users (id UUID PRIMARY KEY, github_user_id BIGINT NOT NULL, github_login VARCHAR(39) NOT NULL, display_name VARCHAR(255), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)");
                statement.execute("CREATE TABLE solutions (id UUID PRIMARY KEY, user_id UUID NOT NULL, client_record_id VARCHAR(36) NOT NULL, platform VARCHAR(20) NOT NULL, problem_number VARCHAR(100) NOT NULL, title VARCHAR(500) NOT NULL, language VARCHAR(100) NOT NULL, code TEXT NOT NULL, result VARCHAR(20) NOT NULL, observed_at TIMESTAMPTZ NOT NULL, solved_at TIMESTAMPTZ NOT NULL, execution_time VARCHAR(50), memory_usage VARCHAR(50))");
            }
            UUID firstUser = UUID.randomUUID();
            UUID secondUser = UUID.randomUUID();
            try (Connection connection = connection("public");
                    PreparedStatement users = connection.prepareStatement("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)");
                    PreparedStatement solutions = connection.prepareStatement("INSERT INTO solutions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                insertLegacyUser(users, firstUser, 10001L, "first-user", "First User");
                insertLegacyUser(users, secondUser, 10002L, "second-user", null);
                for (int index = 0; index < 57; index++) {
                    solutions.setObject(1, UUID.randomUUID());
                    solutions.setObject(2, index % 2 == 0 ? firstUser : secondUser);
                    solutions.setString(3, UUID.randomUUID().toString());
                    solutions.setString(4, index == 0 ? "PROGRAMMERS" : "SWEA");
                    solutions.setString(5, Integer.toString(1000 + index));
                    solutions.setString(6, "Legacy problem " + index);
                    solutions.setString(7, "JAVA");
                    solutions.setString(8, "class Solution {}");
                    solutions.setString(9, "ACCEPTED");
                    solutions.setObject(10, utc("2025-01-02T03:04:05Z"));
                    solutions.setObject(11, utc("2025-01-02T03:04:05Z"));
                    solutions.setString(12, index == 0 ? "101 ms" : null);
                    solutions.setString(13, index == 0 ? "101,164 kb" : null);
                    solutions.executeUpdate();
                }
            }
        }

        private void insertLegacyUser(PreparedStatement statement, UUID id, long githubUserId, String login, String name)
                throws SQLException {
            statement.setObject(1, id);
            statement.setLong(2, githubUserId);
            statement.setString(3, login);
            statement.setString(4, name);
            statement.setObject(5, utc("2025-01-02T03:04:05Z"));
            statement.setObject(6, utc("2025-01-03T03:04:05Z"));
            statement.executeUpdate();
        }

        private void createRebuiltPublicSource() throws SQLException {
            try (Connection connection = connection("public"); Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE users (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, github_id VARCHAR(64))");
                statement.execute("CREATE TABLE solutions (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, capture_id VARCHAR(36))");
            }
        }

        private void dropProductionSchemas() throws SQLException {
            try (Connection connection = DriverManager.getConnection(url, user, password); Statement statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA IF EXISTS codearchive_v2 CASCADE");
                statement.execute("DROP TABLE IF EXISTS public.solutions");
                statement.execute("DROP TABLE IF EXISTS public.users");
                statement.execute("DROP TABLE IF EXISTS public.flyway_schema_history");
            }
        }

        private long historyCount() throws SQLException {
            Number count = scalar("SELECT COUNT(*) FROM flyway_schema_history");
            return count.longValue();
        }

        private long publicCount(String table) throws SQLException {
            return ((Number) scalarInSchema("public", "SELECT COUNT(*) FROM " + quoteIdentifier(table))).longValue();
        }

        private long countInSchema(String targetSchema, String table) throws SQLException {
            return ((Number) scalarInSchema(targetSchema, "SELECT COUNT(*) FROM " + quoteIdentifier(table))).longValue();
        }

        private long versionedHistoryCount(String targetSchema) throws SQLException {
            return ((Number) scalarInSchema(targetSchema,
                    "SELECT COUNT(*) FROM flyway_schema_history WHERE version IS NOT NULL")).longValue();
        }

        private <T> T scalarInSchema(String targetSchema, String sql) throws SQLException {
            try (Connection connection = connection(targetSchema); PreparedStatement statement = connection.prepareStatement(sql);
                    ResultSet resultSet = statement.executeQuery()) {
                assertTrue(resultSet.next(), "Expected a row for: " + sql);
                @SuppressWarnings("unchecked")
                T value = (T) resultSet.getObject(1);
                return value;
            }
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
            assertEquals("YES", nullable("users", "github_avatar_url"));
            assertEquals("NO", nullable("users", "created_at"));
            assertEquals("NO", nullable("solutions", "user_id"));
            assertEquals("NO", nullable("solutions", "capture_id"));
            assertEquals("NO", nullable("solutions", "source_code"));
            assertEquals("NO", nullable("solutions", "language_key"));
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
            assertEquals(1L, ((Number) scalar(
                    "SELECT COUNT(*) FROM pg_indexes "
                            + "WHERE schemaname = ? AND indexname = 'idx_solutions_language_key'", schema)).longValue());
            assertEquals("YES", nullable("solutions", "memory_value"));
            assertEquals("YES", nullable("solutions", "memory_unit"));
            assertEquals("user_settings", scalar("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'user_settings'", schema));
            assertEquals("NO", nullable("user_settings", "github_commit_message_template"));
            assertEquals("NO", nullable("user_settings", "github_header"));
            assertEquals("'{platform}/{number}_{title}/{time}'::character varying", scalar(
                    "SELECT column_default FROM information_schema.columns WHERE table_schema = ? AND table_name = 'user_settings' AND column_name = 'git_path_template'", schema));
            assertEquals("relay_grants", scalar("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'relay_grants'", schema));
            assertEquals("github_commit_jobs", scalar("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'github_commit_jobs'", schema));
            assertEquals("spring_session", scalar("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'spring_session'", schema));
            assertEquals("spring_session_attributes", scalar("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'spring_session_attributes'", schema));
            assertEquals(1L, ((Number) scalar("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'idx_relay_grants_user_device_active'", schema)).longValue());
            assertEquals(1L, ((Number) scalar("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'idx_github_commit_jobs_state_created'", schema)).longValue());
            assertEquals(1L, ((Number) scalar("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'idx_github_commit_jobs_state_updated'", schema)).longValue());
            assertEquals(1L, ((Number) scalar("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'spring_session_ix1'", schema)).longValue());
            assertEquals(1L, ((Number) scalar("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'spring_session_ix2'", schema)).longValue());
            assertEquals(1L, ((Number) scalar("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = 'spring_session_ix3'", schema)).longValue());
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
