# Google Cloud staging infrastructure

This directory contains bounded, idempotent helpers for the staged Google Cloud
work. It does not switch production traffic, change Netlify, or modify the
existing Render service.

## Issue #247: Cloud Tasks boundary

`issue247-bootstrap.ps1` prepares only the resources needed to connect the
already implemented durable GitHub job dispatcher to Google Cloud:

- enables Cloud Run, Cloud Tasks, and IAM Credentials APIs;
- creates separate staging API, worker, and OIDC invoker service accounts;
- creates one low-throughput Cloud Tasks queue in Singapore;
- grants queue-level enqueuer access to the API and recovery worker;
- grants only the identities that create tasks permission to attach the OIDC
  invoker identity;
- lets the Google-managed Cloud Tasks service agent mint tokens for that narrow
  invoker identity.

The default invocation is a read-only plan:

```powershell
./infra/gcp/issue247-bootstrap.ps1 `
  -ProjectId <project-id>
```

Apply the reviewed plan explicitly:

```powershell
./infra/gcp/issue247-bootstrap.ps1 `
  -ProjectId <project-id> `
  -Apply
```

The queue is limited to one dispatch per second and one concurrent dispatch,
with three attempts and bounded exponential backoff. An idle queue does not
send requests. Cloud Run services are deployed separately only after database
and GitHub secrets have been placed in Secret Manager without exposing their
values in shell history or repository files.

### Import existing server secrets

Log in with the official Render CLI first. The import helper reads only the
specified API service variables and never prints their values. Its default mode
checks and displays the key-to-secret mapping:

```powershell
./infra/gcp/import-render-secrets.ps1 `
  -ProjectId <project-id> `
  -RenderServiceId <render-api-service-id>
```

Use `-Apply` to create missing Secret Manager entries, add one exact version
through raw standard input, read it back without displaying it, and verify it
exactly matches Render before granting secret-level access to the staging API
and worker identities. Existing enabled versions are left unchanged unless
`-Rotate` is also specified. After a Cloud Run smoke test passes,
`-DisablePreviousVersions` keeps the verified latest version enabled and
disables superseded versions to limit active-secret cost.

The public API identity can read all imported server settings. The worker is
limited to the three database values plus the GitHub App ID and private key;
OAuth client credentials and the installation slug are not injected into or
readable by the worker.

```powershell
./infra/gcp/import-render-secrets.ps1 `
  -ProjectId <project-id> `
  -RenderServiceId <render-api-service-id> `
  -Apply `
  -DisablePreviousVersions
```

### Deploy and smoke-test the private worker

`deploy-issue247-worker.ps1` builds the existing Java 17 Docker image locally,
pushes one immutable commit tag to a regional Artifact Registry repository, and
deploys a private Cloud Run worker with zero minimum and one maximum instance.
The repository actively deletes images older than one day while retaining the
two newest versions of each package.

The default invocation is a read-only deployment plan. `-Apply` performs the
build and deployment, grants `roles/run.invoker` only to the task OIDC identity,
and sends a harmless task for a unique nonexistent durable job ID. The bounded
smoke retry tolerates a newly created IAM binding's propagation delay. A
successful smoke test requires the authenticated Cloud Tasks request to reach
the worker and return HTTP 204.

```powershell
./infra/gcp/deploy-issue247-worker.ps1 `
  -ProjectId <project-id>

./infra/gcp/deploy-issue247-worker.ps1 `
  -ProjectId <project-id> `
  -Apply
```

## Security boundary

The future worker must be deployed with unauthenticated invocation disabled.
After the worker exists, grant `roles/run.invoker` on that service only to the
`codearchive-task-invoker` service account. Never grant the worker to
`allUsers` or `allAuthenticatedUsers`.

The public staging API uses `codearchive-api-stg` as its Cloud Run service
identity. The private worker uses `codearchive-worker-stg`. Neither identity
uses a downloaded JSON key; Cloud Run provides Application Default Credentials.

## Verified on staging

- The queue, service identities, secret-level access, and narrow OIDC IAM
  boundary are provisioned in `asia-southeast1`.
- The private worker runs with minimum zero, maximum one, concurrency one, and
  an immutable image tag.
- An unauthenticated request receives HTTP 403.
- A Cloud Tasks OIDC request for a nonexistent durable job reaches the worker
  and receives HTTP 204 without source code or credentials in the payload.

## Still required before closing #247

1. Deploy the public staging API from the same verified image digest as part of
   #248 so a real ingest can enqueue its durable job with keyless credentials.
2. With the dashboard closed, submit one new PASS and verify exactly one GitHub
   commit, duplicate-delivery idempotency, and recovery behavior.
3. Keep Render in polling mode until that end-to-end verification passes.

## Issue #248: public staging API

`deploy-issue248-api.ps1` deploys the public staging API from an already
verified immutable Artifact Registry digest. It discovers the private worker,
uses the dedicated API service identity, enables Cloud Tasks dispatch, and
keeps request-based billing with minimum zero, maximum two instances,
concurrency 20, and a database pool of two.

The default invocation is plan-only:

```powershell
./infra/gcp/deploy-issue248-api.ps1 `
  -ProjectId <project-id> `
  -ImageDigest sha256:<64-hex-digest>
```

Add `-Apply` to deploy. The result includes the public staging URL, exact OAuth
redirect URI, ready revision, and post-deploy health latency. The production
Netlify proxy and Render service are not changed.

The local dashboard preview can proxy `/api` to staging without changing
application source or creating a Netlify deploy:

```powershell
$env:CODEARCHIVE_API_PROXY_TARGET = 'https://<staging-api>.a.run.app'
npm --prefix apps/dashboard run dev
```

GitHub must allow the reported staging callback before login can be verified.
Do not replace the production callback when adding a staging callback would be
safer. OAuth/session, GitHub App installation, and real Chrome PASS validation
remain explicit user-facing gates.

### Rollback

`rollback-issue248-api.ps1` selects the previous ready revision by default and
prints a plan. `-Apply` routes 100% of staging traffic to it and requires the
health endpoint to remain UP. Pass `-Revision <revision>` to select an explicit
known-good revision. Traffic changes are limited to the staging service.

### Cost alerts

`configure-issue248-budget.ps1` creates or updates a project-scoped monthly
budget with actual-spend notifications at 50%, 80%, and 100%. The default
amount is 10,000 in the billing account currency; pass `-MonthlyAmount` to
choose a different value.

```powershell
./infra/gcp/configure-issue248-budget.ps1 `
  -ProjectId <project-id> `
  -BillingAccount <billing-account-id> `
  -Apply
```

Budget alerts are not a hard spending cap and do not disable services. The
Cloud Billing Budget API is free; this setup uses role-based email alerts and
does not create a billable Pub/Sub notification path.

### Keyless GitHub Actions deployment

`configure-issue248-github-oidc.ps1` creates a dedicated staging deployer and
Workload Identity Federation provider. Admission is restricted to this exact
repository on `refs/heads/develop`; no service-account JSON key is created.
The deployer can push to the staging Artifact Registry repository, update only
the two existing staging Cloud Run services, attach their service identities,
and enqueue the harmless private-worker smoke task. A project custom role with
only `logging.logEntries.list` lets the workflow confirm that exact task reached
the worker with HTTP 204; it does not grant the broader predefined Logs Viewer
role.

The manual `Deploy GCP Staging` workflow builds one commit-tagged image, deploys
that same image to API and worker, checks public health, and requires a Cloud
Tasks OIDC 204 from the private worker. Configure these non-secret repository
variables from the plan/apply output:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WIF_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`

The workflow intentionally runs only when manually dispatched from `develop`.

### Issue #293: fail-closed staging database preflight

The manual staging workflow and both deployment helpers now run
`staging-db-preflight.mjs` before their first cloud mutation. The preflight
checks the API and worker together against `staging-db-policy.json` and rejects
all of the following by default:

- a service registered with a production role, even when its name ends in
  `-stg`;
- a canonical database identity registered as production;
- a canonical database identity without exactly one reviewed nonproduction
  registration and evidence;
- API and worker aliases that resolve to different canonical database identities;
- missing, expired, contradictory, or ambiguous service/database inventory and unregistered aliases;
- plaintext datasource overrides or Flyway overrides this first slice cannot
  interpret safely;
- any `SPRING_DATASOURCE_*` override outside the reviewed URL, username, and
  password secret bindings;
- non-empty container command/args that could load higher-precedence Spring
  configuration outside the reviewed datasource plan;
- Cloud Run secret annotations that map a datasource alias to another project,
  and qualified or ambiguous secret identities outside the reviewed project;
- a current datasource secret name or numeric version that differs from the
  reviewed inventory.

The policy deliberately starts with
`blocked_pending_verified_inventory`. Do not replace that state with synthetic
sample inventory. Before any staging deployment can be enabled, record the
reviewed GCP project/region/service role, an explicitly approved nonproduction
canonical Neon project/branch/database
and schema relationship, registered pool/direct aliases, an explicit policy
expiry (`validUntil`), and the exact numeric Secret Manager versions with durable evidence. Secret values and JDBC URLs do
not belong in this policy.

A service may currently reference `latest`, but the preflight resolves that
reference to a numeric Secret Manager version and requires it to match the
reviewed policy. The resulting checked plan is fingerprinted, and the workflow
and PowerShell helpers derive their actual `SPRING_DATASOURCE_*` deployment
bindings from that plan using the same numeric versions. The deployment path
therefore does not re-use mutable `latest` for the three database secrets after
checking it.

There is intentionally no `force`, `AllowProduction`, or boolean bypass for
this guard. Plan/`-WhatIf` runs also fail closed while inventory is unverified;
they never report an unknown relationship as safe. Provider read failures are
reported with fixed preflight codes rather than raw provider output.

This is an entrypoint guard, not a universal database firewall. It protects the
manual GCP staging workflow and the two documented PowerShell deploy helpers.
It does not protect raw `gcloud`, Google Cloud Console changes, Render,
arbitrary JVM startup, or other scripts that do not call this preflight. Real
DB separation/provider changes and any production deployment remain separate
owner-approved operational gates.

Local checks for this guard are:

```text
node --test infra/gcp/staging-db-preflight.test.mjs
pwsh -NoProfile -File infra/gcp/staging-db-preflight.integration.ps1
```

The integration script injects fake `gcloud`/`docker` executables into copies
of the real PowerShell entrypoints and asserts that a rejected plan reaches zero
build/push/deploy/migrate/traffic-changing calls and does not echo sentinel
credential/token/source content.

## Production traffic promotion

To stay within the free tier, the verified staging API and worker are promoted
in place instead of keeping a second always-identical Cloud Run pair. The
public browser endpoint remains the Netlify origin, so GitHub OAuth and GitHub
App callbacks continue to use:

```text
https://codearchive-dashboard-beta.netlify.app/api/login/oauth2/code/github
https://codearchive-dashboard-beta.netlify.app/api/github/installations/callback
```

Before changing `netlify.toml`, update the API service's
`GITHUB_REDIRECT_URI` to the Netlify OAuth callback and verify
`/actuator/health`. Production promotion changes only the Netlify `/api/*`
proxy target. The Render service remains unchanged as a rollback target; a
rollback consists of restoring its proxy URL and deploying that one-line
Netlify change.
