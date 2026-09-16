# Production database migrations

The default and `prod` profiles use PostgreSQL, Flyway, and Hibernate schema
validation. Flyway is enabled for those profiles with
`baseline-on-migrate=false` and `clean-disabled=true`; startup never guesses
that an existing schema should be adopted and never drops production data.
The `local` and `test` profiles continue to use their existing H2 settings,
Hibernate schema generation, and the H2-only `LegacyUserSchemaMigration`.

## Version history

| Version | Purpose |
| --- | --- |
| `V1__create_legacy_schema.sql` | Creates the pre-GitHub `users` and `solutions` tables. `email` and `password_hash` are required, matching the legacy Hibernate schema. |
| `V2__add_github_identity.sql` | Adds nullable GitHub profile columns, makes the legacy credential columns nullable, and adds the unique `github_id` constraint. |
| `V3__add_solution_ordering_index.sql` | Adds the `(user_id, solved_at DESC)` index used by the per-user solution listing query. |
| `V4__import_legacy_codearchive.sql` | In the `prod` profile only, validates and imports the known UUID/GitHub legacy public tables into the isolated `codearchive_v2` schema. |

`V2` is intentionally a narrow upgrade. It does not rewrite existing rows or
discard legacy credentials. PostgreSQL's unique constraint permits multiple
`NULL` values, so users without a GitHub id are allowed while every populated
GitHub id remains unique.

## Fresh PostgreSQL database

For an empty database, set the normal PostgreSQL connection variables and
start the application with the `prod` profile. Production Flyway creates and
uses `codearchive_v2.flyway_schema_history`, runs V1 through V4 there, and
Hibernate validates `codearchive_v2`. It never reads, baselines, repairs, or
changes `public.flyway_schema_history`.

When the recognized legacy source tables exist in `public`, V4 first validates
their complete shape and all import-critical values, then imports GitHub users
and solutions in the same transaction. Numeric performance strings are parsed
without punctuation; absent or malformed optional values remain NULL.
Programmers URLs are rebuilt from their problem number and SWEA uses the stable
problem-list fallback. An absent public source or an already rebuilt public
shape is a no-op. Any other public shape fails V4 before inserts, so investigate
instead of baselining or editing the legacy schema.

## Adopting an existing Hibernate schema

Take a database backup and inspect the schema during a maintenance window
before recording a Flyway baseline. The following query shows the columns and
nullability that matter for choosing the baseline:

```sql
SELECT table_name, column_name, data_type, character_maximum_length,
       is_nullable, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'solutions')
ORDER BY table_name, ordinal_position;
```

Also inspect the primary keys, foreign key, unique constraints, and indexes.
The expected names for a schema created by these migrations are
`pk_users`, `pk_solutions`, `fk_solution_user`, `uk_users_email`,
`uk_users_github_id`, `uk_solution_user_capture`, and
`idx_solutions_user_solved_at`.

Use the Flyway CLI version compatible with the application's Boot-managed
Flyway dependencies. Set the same JDBC URL, user, password, schema, and
migration locations used by the application. Do not use `clean` and do not
turn on `baselineOnMigrate`:

From `apps/api` in PowerShell, point the CLI to the actual migration directory
before running the commands below (the CLI does not read Spring's classpath):

```powershell
$env:FLYWAY_LOCATIONS = 'filesystem:' + (Resolve-Path './src/main/resources/db/migration').Path.Replace('\', '/')
```

Credentials can instead be supplied through `FLYWAY_URL`, `FLYWAY_USER`, and
`FLYWAY_PASSWORD`; omit the corresponding command-line arguments when using
those variables. Never commit credentials or a filled-in command to source control.

```text
flyway -url=<jdbc-postgresql-url> -user=<user> -password=<password> \
  -schemas=public -defaultSchema=public \
  -baselineOnMigrate=false -cleanDisabled=true info
```

### Legacy schema (baseline at V1)

Choose this path when the database has the legacy `users` and `solutions`
tables, has no GitHub columns, and matches V1. Confirm that existing rows do
not violate the V1 primary key, foreign key, unique, length, or required
column definitions. Then record that V1 is already present and apply V2:

```text
flyway -url=<jdbc-postgresql-url> -user=<user> -password=<password> \
  -schemas=public -defaultSchema=public \
  -baselineOnMigrate=false -cleanDisabled=true \
  baseline -baselineVersion=1 -baselineDescription="legacy Hibernate schema"

flyway -url=<jdbc-postgresql-url> -user=<user> -password=<password> \
  -schemas=public -defaultSchema=public \
  -baselineOnMigrate=false -cleanDisabled=true migrate
```

The baseline command records V1 without running it. The migrate command then
runs V2 and V3, preserving every existing user and solution row.

### Current GitHub-enabled schema (baseline at V2)

Some installations may have been run with Hibernate `ddl-auto=update` after
GitHub login support was introduced. If inspection confirms that the schema
already has all four GitHub columns, nullable `email` and `password_hash`, and
the unique `github_id` constraint, record V2 directly:

```text
flyway -url=<jdbc-postgresql-url> -user=<user> -password=<password> \
  -schemas=public -defaultSchema=public \
  -baselineOnMigrate=false -cleanDisabled=true \
  baseline -baselineVersion=2 -baselineDescription="existing GitHub schema"
```

Do not baseline at V2 when any of those columns or constraints are missing.
Reconcile the schema in a reviewed, tested SQL change first, or use the V1
adoption path when the database is still the legacy shape. After a V2
baseline, migrate applies V3 and creates the ordering index. After either
baseline path, start the application and confirm that Flyway reports the
expected history and Hibernate validation succeeds.

## Repeatable PostgreSQL verification

From the project root with Docker running and `JAVA_HOME` set to JDK 17+:

```powershell
./scripts/test-postgres.ps1
```

This runner uses an isolated PostgreSQL 17 container on a random loopback port,
generates transient credentials, runs `PostgreSqlMigrationTest`, and stops its
container on success or failure. It never attaches an existing volume. Tests
cover new schemas, repeat migration, explicit V1/V2 adoption, retained rows,
rejection of automatic adoption, isolated `codearchive_v2` imports from a
legacy public fixture, preserved public row/history counts, safe rebuilt-public
no-op behavior, and Hibernate schema validation. The regular
H2 API tests still run with `./mvnw.cmd test`; migration tests skip unless all
`PG_TEST_URL`, `PG_TEST_USER`, and `PG_TEST_PASSWORD` variables are set.
