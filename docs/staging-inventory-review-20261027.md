# Staging datasource policy renewal — 2026-10-27

The staging DB isolation policy (`infra/gcp/staging-db-policy.json`) lapsed on
2026-10-13, so `Deploy GCP Staging` stopped at `POLICY_INVENTORY_EXPIRED`
(runs 40437453092, 40439094738, 40439236564 on 2026-10-27). There was no
backend deploy between 2026-10-12 and this renewal.

## What this renewal is — and is not

- The repository owner (`devkimhongjin`) asked for the backend deploy to be
  completed without a new manual console inspection. The review and expiry
  dates were renewed for seven days (to 2026-11-03T03:20:00Z).
- **No new inspection of Cloud Run or Secret Manager was made for this
  renewal.** The service bindings, secret versions and the Neon mapping in the
  policy are exactly the ones recorded by `docs/staging-inventory-review-20261006.md`
  (mapping verified 2026-09-23, bindings re-read 2026-10-06). Nothing in the policy
  other than the two dates and the evidence wording was changed.
- This is a weaker statement than the earlier reviews. It is not a claim that the
  live services still match.

## What still protects the deploy

`infra/gcp/staging-db-preflight.mjs prepare` runs at the start of every deploy
and reads the live Cloud Run services and Secret Manager version metadata. It
denies the deploy, before anything is built or migrated, when any of these
differ from the policy:

- a service is not registered as `nonproduction`, or targets a protected
  production database;
- a datasource secret name, project or numeric version differs from the approved
  one, or the version is not `ENABLED`;
- the Spring profile is not `prod`, or the container has a command/args,
  Flyway or datasource override;
- the API and worker do not resolve to the same canonical database.

If the live services have changed since 2026-10-06, the deploy fails at that
step with a specific code and nothing is deployed or migrated.

## What the deploy applies

The deploy builds `develop` (`673a194`). It includes the GitHub commit author fix
(#483) and the popup link support (#486), whose migration `V31` adds the nullable
column `github_commit_jobs.github_url` to the staging database through Flyway.
The protected production Neon branch is not a target.

Health (`/api/health`) and worker delivery must be checked after the deploy; this
renewal is not migration or upload evidence.

## Next review

Renew the policy from a fresh inspection (read-only `gcloud run services describe`
for both services and `gcloud secrets versions list` for the three datasource
secrets) before relying on it after 2026-11-03.
