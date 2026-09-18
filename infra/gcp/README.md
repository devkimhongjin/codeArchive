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
