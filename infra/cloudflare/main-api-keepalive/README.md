# Main API beta keepalive

This is a dedicated, credential-free Cloudflare Cron Worker for the beta Main
API. Every 12 minutes it performs exactly one `GET` request to the configured
`MAIN_API_HEALTH_URL`. The beta configuration targets the approved Main API
health endpoint:

`https://codearchive-api.onrender.com/actuator/health`

The request uses `redirect: "error"`, sends no headers or body, reads no
response content, and does not retry within one schedule event. A failed event
is quiet; the next scheduled event is the only retry. This keepalive is only a
best-effort cold-start mitigation and is not part of capture or sync
correctness. Extension alarms, local persistence, and retry behavior remain
required.

## Free-tier estimate

At 12-minute cadence this is 120 scheduled requests/day, about 3,600/month.
That is far below the current Workers Free 100,000 requests/day limit. The
current Free account limit is five Cron Triggers total, so provisioning still
requires checking the account's available trigger slot.

Render Free grants 750 instance-hours/month. One always-awake Main API service
uses approximately 720–744 hours/month, leaving roughly 6–30 hours. Keeping
the Analysis service inactive is therefore necessary in beta: do not start or
redeploy it, and do not add an Analysis keepalive. Existing resources and
configuration remain unchanged until a separately approved decision.

## Local validation

From this directory:

```sh
npm test
npx wrangler check
npx wrangler deploy --dry-run
```

No deploy or provider mutation is part of this change.

## Rollback/removal

Disable the Cron Trigger and delete the Worker through the Cloudflare control
plane only after a fresh owner approval. The local rollback is to remove this
directory from the branch; no API, Extension, Dashboard, Render, Analysis, or
secret changes are required.
