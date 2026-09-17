# Cloud Run readiness runbook

## Current safe state

The deployed Render API remains in `GITHUB_DISPATCH_MODE=polling` (the default).
Spring Security sessions are stored in Flyway-managed PostgreSQL tables in
`codearchive_v2`; the production session schema initializer is disabled and the
Hikari maximum pool defaults to five connections. Session cleanup is hourly, not
per-minute, to avoid preventing Neon scale-to-zero.

No Google Cloud project, API, queue, service account, scheduler job, or deployment
is created by this repository or this runbook. Complete account authentication and
review the platform ownership before running any placeholder command below.

## Future two-service configuration

The future cutover uses two Cloud Run services with separate exposure and IAM
responsibilities. These are templates only; do not apply them until account
authentication and platform ownership are resolved.

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

## Future cutover order

1. Keep current Render production on `GITHUB_DISPATCH_MODE=polling` until both
   future services, IAM bindings, and recovery monitoring have been reviewed.
2. After authentication is repaired, the platform owner creates the queue, private
   worker service, task-enqueuer identity/role, task and scheduler invoker bindings,
   and Scheduler OIDC target through approved IaC or console processes.
3. Deploy and verify the private worker first with unauthenticated invocation
   disabled. Validate queue-header rejection, OIDC access, duplicate delivery, and
   low-frequency recovery without exposing it publicly.
4. Configure the public capture-ingress API enqueuer with cloud-tasks mode only
   after the worker is ready. Validate that a capture commits a `PENDING` job and
   creates a task containing only `jobId`.
5. Observe successful task execution, retry, stale-lease-to-`UNKNOWN`, and recovery
   behavior before retiring polling. `UNKNOWN` is never retried automatically.
