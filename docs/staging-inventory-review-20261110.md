# Staging datasource policy renewal — 2026-11-10

The staging DB isolation policy (`infra/gcp/staging-db-policy.json`) was due to
lapse on 2026-11-11T07:50:00Z. This renewal is the first one based on a fresh
inspection by the read-only `Staging DB inventory` workflow (#511) instead of a
date-only extension (2026-10-27, 2026-11-04).

## Inspection

- Workflow run 42739912090 on `develop` (`e230e49`), inspected at
  2026-11-10T02:02:23Z with the same keyless identity as the deploy.
- Result: `INVENTORY_OK 5373e07ea00c9aeea9a9cd9635f4cc1f0d835a1443c2ddd0333996c7682b7222`.
  The same live state gives the same fingerprint a deploy preflight produces.
- `codearchive-api-stg` and `codearchive-github-worker-stg` were each checked
  for a nonproduction registration, the `prod` Spring profile, empty container
  command/args, no plaintext datasource, Flyway or other ambiguous Spring
  overrides, and the `staging-direct` alias.
- Both bind `codearchive-staging-datasource-url`, `-username` and `-password`
  at numeric version 1, each `ENABLED` in Secret Manager, and both resolve to
  `neon:old-sea-48302710:br-damp-sun-azcrpfkb:neondb:codearchive_v2`, which is
  registered as nonproduction and is not the protected production branch.

## What changed

`reviewedAt` is now the inspection time (2026-11-10T02:02:23Z) and `validUntil`
seven days later (2026-11-17T02:02:23Z). The service and alias evidence cite the
run. Service bindings, secret names and versions, and the Neon mapping are
unchanged.

## Limits

- The inspection reads Secret Manager metadata, not secret values. The Neon
  branch behind secret version 1 was verified on 2026-09-23; secret versions
  are immutable, so that mapping still applies to the version observed now.
- The deploy preflight re-reads the live services before every deploy and stops
  on any difference, as before.

## Next review

Run `Staging DB inventory` again before 2026-11-17T02:02:23Z and renew from
its result, following `infra/gcp/README.md`.
