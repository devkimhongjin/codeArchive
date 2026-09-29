# Cloud Run readiness runbook

## Current state (2026-09-29)

Netlify `/api` targets the Cloud Run API, with a separate private GitHub worker
in `asia-southeast1`. Both serve the same commit-tagged image and use Cloud Tasks
dispatch; Render remains a rollback target. Spring Security sessions are stored
in Flyway-managed PostgreSQL tables in `codearchive_v2`. The Cloud Scheduler API
and recovery job are not yet enabled, so unattended outbox recovery is **not**
complete. Consult `infra/gcp/README.md` for current deployment and recovery
steps before making an operational change. The configuration below is a contract,
not evidence that every acceptance criterion has passed.

## Two-service configuration contract

The deployed pair uses separate exposure and IAM responsibilities. These are
reference settings; inspect actual revisions and secret versions before any
deployment, rather than assuming the text matches the running services.

### Public capture-ingress API enqueuer

The public API receives captures and is the service that disables polling and
enqueues a task after the capture/job database transaction commits. Configure it
with the following values:

```
GITHUB_DISPATCH_MODE=cloud-tasks
GITHUB_WORKER_HTTP_ENABLED=false
GCP_PROJECT_ID=<project-id>
GCP_TASKS_LOCATION=<region>
GCP_TASKS_QUEUE=<queue-name>
GCP_TASKS_WORKER_URL=<private-worker-https-url>
GCP_TASKS_OIDC_SERVICE_ACCOUNT=<task-invoker-service-account-email>
GCP_TASKS_OIDC_AUDIENCE=<private-worker-https-url>
DB_POOL_MAX_SIZE=5
```

Grant this service identity the approved role that permits task creation for the
specific queue. It needs application-default/task-enqueuer credentials, but it
must not expose the internal worker controller.

### Private worker and recovery service

The private worker consumes execution requests and its recovery endpoint may
re-enqueue durable `PENDING` job ids, so it needs the same queue configuration:

```
GITHUB_DISPATCH_MODE=cloud-tasks
GITHUB_WORKER_HTTP_ENABLED=true
GCP_PROJECT_ID=<project-id>
GCP_TASKS_LOCATION=<region>
GCP_TASKS_QUEUE=<queue-name>
GCP_TASKS_WORKER_URL=<private-worker-https-url>
GCP_TASKS_OIDC_SERVICE_ACCOUNT=<task-invoker-service-account-email>
GCP_TASKS_OIDC_AUDIENCE=<private-worker-https-url>
DB_POOL_MAX_SIZE=5
```

Cloud Tasks mode fails startup if any required task-delivery setting is blank. It
uses the official Java client, deterministic task names (`github-job-<jobId>`), and
the exact payload `{"jobId":<id>}`. Task creation after a committed capture is best
effort: an enqueue failure only leaves the already durable job `PENDING`, which the
recovery endpoint can enqueue later. `ALREADY_EXISTS` is successful idempotent
delivery.

## Private worker security requirements

Deploy the worker as a separate Cloud Run service that **disallows unauthenticated
invocation**. Cloud Run IAM validates Cloud Tasks and Cloud Scheduler OIDC tokens;
the application intentionally does not replace IAM with browser session security.
Only with `GITHUB_WORKER_HTTP_ENABLED=true` are these endpoints registered:

- `POST /internal/github/jobs/{jobId}` — Cloud Tasks execution. It additionally
  requires `X-CloudTasks-QueueName` to match `GCP_TASKS_QUEUE`; retryable
  pre-write failures return a non-2xx response until the third attempt.
- `POST /internal/github/recovery` — a low-frequency OIDC-authenticated Cloud
  Scheduler target, intended to mark stale `RUNNING` jobs `UNKNOWN` and enqueue
  outstanding `PENDING` jobs.

Keep these endpoints absent from the public API service by leaving
`GITHUB_WORKER_HTTP_ENABLED=false`; the controller is then not registered. A security
filter may reject a tokenless request before routing, so callers must not rely on a
specific HTTP status for a disabled endpoint.
Do not grant public invoker access. Grant Cloud Tasks its task-invoker IAM binding
and Cloud Scheduler its recovery-invoker IAM binding; both callers use OIDC. Do not
forward GitHub source, credentials, or personal data into a task payload.

## Remaining acceptance order

1. Inspect the current API/worker pair, numeric database secret bindings, private
   IAM boundary, queue limits, and billing account. Establish whether the
   Scheduler API was previously enabled and inventory dormant jobs before
   enabling it: re-enablement can run missed jobs immediately. The plan-only
   helper in `infra/gcp/README.md` refuses to apply while the API is disabled.
2. Validate Scheduler OIDC against the private worker and verify that an enqueue
   failure leaves a durable `PENDING` job that recovery safely re-enqueues.
   `UNKNOWN` must never be retried automatically.
3. With all Dashboard documents closed, verify one real PASS through local save,
   automatic sync, and exactly one GitHub commit. Separately test duplicate task
   delivery, revoked permissions, restart/scale-to-zero, and rollback procedures.
4. Do not close #247–#249 or remove the Render rollback target based only on a
   single successful commit or on source-code readiness.
