# Staging datasource policy renewal — 2026-11-25

The staging DB isolation policy (`infra/gcp/staging-db-policy.json`) lapsed on
2026-11-17T02:02:23Z. No deployment ran while it was expired; the last one was
on 2026-11-10. It is renewed from a fresh read-only `Staging DB inventory` run.

## Inspection

- Workflow run 45523902218 on `develop` (`e54499e`), inspected at
  2026-11-25T01:11:56Z.
- Result: `INVENTORY_OK 5373e07ea00c9aeea9a9cd9635f4cc1f0d835a1443c2ddd0333996c7682b7222`,
  the same fingerprint as the 2026-11-10 review.
- `codearchive-api-stg` and `codearchive-github-worker-stg` passed every deploy
  preflight check except the policy expiry.
- Both bind `codearchive-staging-datasource-url`, `-username` and `-password`
  at numeric version 1 and resolve to
  `neon:old-sea-48302710:br-damp-sun-azcrpfkb:neondb:codearchive_v2`.

## What changed

`reviewedAt` is the inspection time and `validUntil` seven days later
(2026-12-02T01:11:56Z). The evidence cites the run. Service bindings, secret
names and versions, and the Neon mapping are unchanged.

## Limits

- The inspection reads Secret Manager metadata, not secret values. The Neon
  branch behind secret version 1 was verified on 2026-09-23.
- The deploy preflight re-reads the live services before every deploy.

## Next review

Run `Staging DB inventory` again before 2026-12-02T01:11:56Z.
