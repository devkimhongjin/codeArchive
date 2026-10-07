# Staging datasource inventory review — 2026-10-06

Read-only Cloud Run service descriptions and Secret Manager **version metadata**
were checked before authorizing a staging build/deploy. No secret payload, JDBC
URL, credentials, source code, or user data was printed or changed.

- Project: `project-eab5ae90-9598-4b25-92f`; region: `asia-southeast1`.
- API ready revision: `codearchive-api-stg-00015-bs5`.
- Worker ready revision: `codearchive-github-worker-stg-00019-t5m`.
- Both use source image `b80bed645e18997338be2e9244fdd65621c302b9`, Spring profile
  `prod`, and no container command/args overrides.
- Both bind URL, username, password to numeric version `1` of
  `codearchive-staging-datasource-url`, `codearchive-staging-datasource-username`,
  and `codearchive-staging-datasource-password`, respectively.
- All three immutable versions remain ENABLED; creation times are
  `2026-09-23T04:43:32.547801Z`, `2026-09-23T04:43:47.455123Z`, and
  `2026-09-23T04:43:50.785511Z`.

The canonical Neon project/branch/database mapping is the existing mapping
verified on 2026-09-23. It is retained based on unchanged immutable datasource
versions, not a new Neon provider inspection. No database alias, canonical
identity, secret version, service role, or protected production registration is
changed. The policy review/expiry is renewed for seven days for these same
bindings; the existing preflight still rejects overrides or differing bindings.

The requested deploy affects the beta dashboard's existing staging API and
private GitHub worker and applies V19/V20 there through Flyway. It does not target
the protected production Neon branch. Health and worker delivery must be checked
after deploying; this inventory review is not migration or upload evidence.
