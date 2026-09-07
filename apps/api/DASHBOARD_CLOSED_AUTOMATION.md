# Dashboard-closed automation foundation

This document records the Slice 1 server contract. It is an API foundation only;
it does not create a scheduler or change a provider/runtime resource.

## Relay grant protocol

Dashboard-authenticated requests use the existing session cookie and the exact
configured Dashboard `Origin`. The server derives the account from that session.

1. `POST /api/v1/relay/grants/challenge`
   - Request: `{ "deviceId": "...", "publicKey": "base64url(X.509 Ed25519 key)" }`
   - `deviceId` is 16–128 ASCII characters from `[A-Za-z0-9_-]`.
   - The server stores the public key and only a SHA-256 challenge hash.
   - The challenge is single-use and expires after 2 minutes.
2. `POST /api/v1/relay/grants`
   - Request: `{ "deviceId": "...", "challengeId": "uuid", "challenge": "...", "publicKey": "...", "signature": "base64url(Ed25519 signature)" }`
   - The signature covers the exact challenge string returned by step 1.
   - The response contains the relay credential once. The credential is
     `grantId.secret`; only its SHA-256 hash is stored.
3. `POST /api/v1/relay/grants/{grantId}/rotate`
   - Requires a fresh Dashboard session proof and a fresh challenge/signature.
   - The old grant is revoked before the new grant is issued.
4. `DELETE /api/v1/relay/grants/{grantId}`
   - Revokes the grant and disables the account's relay/source-transfer profile.

Grants live for 30 days, are bound to the account, device, public-key hash and
current ownership generation, and are revoked on rotation, explicit disable,
logout, account switch, or device replacement. Relay credentials are accepted
only on `POST /api/v1/relay/captures`; a valid relay credential on any other API
route is rejected. A relay payload cannot supply `userId` or `accountId`.

## Append-only capture ingest

`POST /api/v1/relay/captures` requires `Authorization: Bearer grantId.secret`.
The request is `{ "records": [ ... ] }`; each record contains:

```json
{
  "clientRecordId": "stable-client-id",
  "platform": "SWEA|PROGRAMMERS",
  "problemNumber": "...",
  "title": "...",
  "language": "...",
  "code": "...",
  "result": "ACCEPTED",
  "solvedAt": "2026-01-01T00:00:00Z",
  "observedAt": "2026-01-01T00:00:00Z",
  "capturedAt": "2026-01-01T00:00:00Z",
  "executionTime": "...",
  "memoryUsage": "...",
  "aiUsage": "used|not_used|unknown"
}
```

The server writes accepted captures with `accepted_capture=true` and the grant's
generation. It never updates or deletes through this endpoint. A batch has at
most 25 records and 1,000,000 code characters; a record has at most 200,000
code characters. The endpoint permits at most 60 requests per grant per minute.
`(user_id, client_record_id)` is idempotent: an identical retry returns
`EXISTING`, while a different body returns a non-acknowledgeable conflict.

## Durable profile and ownership

`GET` and `PUT /api/v1/automation` are Dashboard-session endpoints. The PUT
body includes the device, source-transfer and GitHub-auto flags, consent flags,
`PAGE_OWNED` or `DURABLE_SERVER`, an optional GitHub target, and an
`expectedVersion`. The server rejects stale versions.

Every material change increments the ownership `generation`; a target change
increments `targetGeneration`. Relay grants are revoked on a material change.
Switching to `DURABLE_SERVER` stops active page-owned runs before the durable
mode is stored. Switching back is rejected while a durable claim is active.
Page-owned V9 start/claim/live checks also reject a durable profile, so a stale
page client cannot write after the transition.

Automatic selection is new-capture-only: a solution must be an accepted capture,
have `capture_generation` equal to the current profile generation, and have
`captured_at >= github_enabled_at`. Older captures are never backfilled.

## Worker invocation and provider safety

`DurableAutomationWorker.runOnce()` is the invocation abstraction. It claims at
most one solution with `FOR UPDATE SKIP LOCKED`, a single per-account active
claim, and a 60-second lease. An expired claim can be recovered after process
restart. `ATTEMPTED`, `SUCCEEDED`, `REJECTED`, and `UNKNOWN` are terminal for
that solution; an `UNKNOWN` provider outcome is never retried and disables
GitHub auto-commit. A normal pre-dispatch rejection also pauses the durable
GitHub run.

Before dispatch, the worker rechecks the claim, profile generation, ownership
mode, consents, installation ownership, repository identity/privacy, branch
HEAD, protected-branch status, path obstruction, and source hash. It then calls
the existing conditional create-only GitHub writer. A successful commit advances
the stored expected HEAD. Provider secrets and source text are not persisted in
the durable tables.

No scheduler, Render Background Worker, cron, queue, provider resource, secret,
environment variable, or deployment is created by Slice 1. A future invocation
host must be approved separately before runtime/provider mutation.

## Migration recovery

`V10__dashboard_closed_durable_automation.sql` is additive. If rollout must be
paused, leave durable mode disabled and stop invoking `runOnce()`; existing V1–V9
page-owned data remains usable. Do not drop the V10 tables or columns while any
future client/server build may reference them. A later, separately reviewed
cleanup migration may archive attempts and remove the feature after all durable
claims are terminal.
