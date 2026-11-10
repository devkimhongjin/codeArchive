# Staging datasource policy renewal — 2026-11-04

The staging DB isolation policy (`infra/gcp/staging-db-policy.json`) lapsed on
2026-11-03T03:20:00Z, so `Deploy GCP Staging` would stop at
`POLICY_INVENTORY_EXPIRED`. The last backend deploy was run 41376025536 on
2026-11-02, before the expiry.

## Why now

#503 stops idle pooled connections from keeping the Neon compute awake. Neon's
Free plan allows 100 CU-hours a month; 16.9 were used from 2026-11-01 to
2026-11-03 (about 5.5 a day), which would exhaust the month around
2026-11-18 and suspend the database until 2026-12-01. The fix only takes
effect once the API and worker are redeployed.

## What this renewal is — and is not

- The repository owner (`devkimhongjin`) chose to renew the dates without a new
  inspection, as on 2026-10-27. The review and expiry dates were renewed for
  seven days (2026-11-04T07:50:00Z to 2026-11-11T07:50:00Z).
- **No new inspection of Cloud Run or Secret Manager was made.** The service
  bindings, secret versions and the Neon mapping are still the ones recorded by
  `docs/staging-inventory-review-20261006.md` (mapping verified 2026-09-23,
  bindings re-read 2026-10-06). Only the two dates and the evidence wording
  changed.
- This is the second date-only renewal in a row. It is not a claim that the
  live services still match.

## What still protects the deploy

`infra/gcp/staging-db-preflight.mjs prepare` runs at the start of every deploy,
reads the live Cloud Run services and Secret Manager version metadata, and
denies the deploy before anything is built or migrated when they differ from
the policy (see `docs/staging-inventory-review-20261027.md` for the list). The
protected production Neon branch is not a target.

## Next review

Renew the policy from a fresh inspection (read-only `gcloud run services
describe` for both services and `gcloud secrets versions list` for the three
datasource secrets) before relying on it after 2026-11-11.
