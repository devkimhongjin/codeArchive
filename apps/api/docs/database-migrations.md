# Production database migrations

Production uses PostgreSQL, Flyway, and Hibernate validation. With the `prod`
profile, Flyway uses the isolated `codearchive_v2` schema and records exactly six
versioned migrations in `codearchive_v2.flyway_schema_history`. It has
`baseline-on-migrate=false`, `clean-disabled=true`, and `create-schemas=true`.
Startup never adopts, repairs, or drops an unknown database history.

The local and test profiles are self-contained H2 configurations. Flyway is disabled
there; Hibernate creates application tables and Spring Session JDBC initializes its
H2 session tables. Production Spring Session schema initialization is disabled:
Flyway owns it through V6.

## Version history

| Version | Purpose |
| --- | --- |
| `V1__create_legacy_schema.sql` | Creates the original `users` and `solutions` schema with legacy credential columns. |
| `V2__add_github_identity.sql` | Adds nullable GitHub identity/profile columns, permits legacy credential nulls, and adds the unique GitHub-id constraint. |
| `V3__add_solution_ordering_index.sql` | Adds `(user_id, solved_at DESC)` for per-user solution listing. |
| `V4__import_legacy_codearchive.sql` | Validates and imports the recognized legacy public GitHub/UUID source into `codearchive_v2`; absent or rebuilt sources are no-ops. |
| `V5__issue_241_settings_and_memory.sql` | Adds explicit memory fields, account settings, opaque relay grants, and durable GitHub commit jobs plus their indexes. |
| `V6__cloud_run_readiness.sql` | Adds Spring Session JDBC `spring_session` and `spring_session_attributes` tables and session-id, expiry-time, and principal-name indexes. |

V5 retains the legacy `solutions.memory_usage` value without inventing a unit. New
captures use `memory_value` and `memory_unit`. Its relay grants are opaque hashes,
and `github_commit_jobs` has the `(user_id, capture_id)` idempotency constraint with
state/creation and state/update indexes.

V6 creates the standard Spring Session JDBC tables additively. In production the
application accesses them in `codearchive_v2`; the session cleanup job is hourly,
which avoids repeatedly waking a scale-to-zero database.

## Current history expectations

- A fresh production schema migrates V1 through V6: six versioned history rows.
- A V1 baseline has one baseline/history row, then V2 through V6 execute: five
  migrations after baselining.
- A V2 baseline has one baseline/history row, then V3 through V6 execute: four
  migrations after baselining.
- A second migration run executes zero migrations and keeps the six-version history.

For the recognized public legacy import path, Flyway history remains isolated in
`codearchive_v2`; it does not modify `public.flyway_schema_history`.

## Adoption and verification

Take a backup and inspect the existing database during a maintenance window before
recording a baseline. Baseline only the exact V1 or V2 shapes above. Do not enable
`baselineOnMigrate`, do not use `clean`, and do not edit an unrecognized public
schema until it has a reviewed migration plan.

The PostgreSQL migration suite runs when `PG_TEST_URL`, `PG_TEST_USER`, and
`PG_TEST_PASSWORD` are set. It verifies fresh/repeat migration, V1/V2 baselines,
legacy imports, the isolated production schema/history, V5 structures, V6 Spring
Session tables/indexes, and Hibernate validation. Without those environment values,
the PostgreSQL-only tests are intentionally skipped while the H2 API suite remains
self-contained.
