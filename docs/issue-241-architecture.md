# Issue 241 architecture and runbook

## Account settings

`GET` and optimistic `PUT /api/settings` are session-authenticated.  The immutable
CodeArchive user id is never accepted from a client.  `version` must be echoed by a
writer; a stale update receives `409`.  Download names and Git paths intentionally
use separate templates: download names reject directories, while Git paths must be
relative and cannot traverse outside the configured root.

Dashboard settings, authenticated relay grant/revocation, and GitHub target-browse
requests additionally carry `X-CodeArchive-Github-Id`: the immutable GitHub numeric
identity that the rendered Dashboard expects. It is an assertion, not credentials;
the server first authenticates the session and resolves its `AppUser`, then compares
the assertion before any provider call, grant/revoke, read, or write. Missing or
malformed assertions return `400`, and a changed session identity returns `409` so
the client discards its draft, closes authority, and requires reconnect. The
bearer-only self-revocation route remains bearer-bound and does not use this header.

The supported Shiki selections are `github-light`, `vitesse-light`,
`catppuccin-latte`, `solarized-light`, `one-light` and `github-dark`,
`vitesse-dark`, `catppuccin-mocha`, `dracula`, `one-dark-pro`.  All are exact Shiki
4.4.3 IDs.  Unsupported languages are displayed as plain text.

## Relay and automation boundary

The Dashboard obtains `POST /api/relay/grants` while authenticated and provides the
result to the paired extension through its capability-fenced bridge.  A grant is a
32-byte random opaque bearer, SHA-256 hashed at rest, device/generation bound and
revocable. `DELETE /api/relay/grants/{deviceId}` is an authenticated, CSRF-fenced,
idempotent account-scoped revocation endpoint. Settings generation changes and
logout revoke active grants as well. The extension persists only this bearer, account id, generation and
relay endpoint; it has no GitHub OAuth, App, installation or repository token.
An explicit extension OFF stops local sending immediately, then uses the bearer-only
`DELETE /api/relay/grants/self` endpoint to revoke that same grant. Offline OFF is
retained as `REVOCATION_PENDING` and retried by the bounded alarm drain; the bearer
is erased only after confirmation (or expiry).

`POST /api/relay/captures` and `DELETE /api/relay/grants/self` are the two
unauthenticated-session bearer-only routes. The append endpoint derives the user
from its grant and uses the existing `(user,captureId)` idempotency key; self-revoke
can only invalidate that same grant. Both are excluded from CSRF because they do not
use cookies; all other API routes retain session/CSRF protection. Local IndexedDB is committed before relay.
No successful acknowledgement is inferred until the API stores the capture.

`github_commit_jobs` is an additive durable ledger. The concrete server-only GitHub
App provider activates only when `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are
configured and an installation is selected in account settings (optional
`CODEARCHIVE_GITHUB_API_BASE` is available for a controlled test endpoint). It mints
a short-lived installation token, re-reads branch HEAD and target generation
immediately before a non-force ref update. A missing path is created, an identical
file is treated as already synchronized, and a changed file is replaced only in a
new commit whose parent is the still-current observed HEAD. A configured target without
those App credentials reports `PROVIDER_UNAVAILABLE`; no write is attempted. Never
retry an unknown possibly-sent provider mutation; leave it `UNKNOWN` for operator
review.

The dispatcher processes only `PENDING` jobs. The default `polling` dispatcher keeps
the existing Render scheduler behavior. A future `cloud-tasks` dispatcher enqueues
only a deterministic durable job id after the capture/job transaction commits; its
private Cloud Run worker endpoint is conditionally registered and protected first by
Cloud Run IAM/OIDC. See `docs/cloud-run-readiness.md` for the paused cutover runbook.
It revalidates the settings generation,
both automation flags, target configuration and capture before invoking the injectable
provider boundary. Retryable pre-write failures are bounded to three attempts;
`UNKNOWN` is terminal and is never automatically retried. The concrete provider
stays fail-closed while the required server configuration is absent.

## GitHub target selection

The Dashboard reads a server-verified cascade under `/api/github/targets`: personal
App installations whose immutable installation-account ID matches the authenticated
GitHub identity, then installation-token repositories, branches, and directory
children. Client-supplied
owner, repository, installation, and path text is never authority. The server resolves
repository IDs within the verified installation (searching at most 100 pages), validates
branch membership, accepts only safe relative directories, and filters non-directory,
symlink, and submodule content entries. Requests return `401` without GitHub session,
`403` for installation/repository/branch mismatch, `400` for invalid pagination/path,
and `503` when the provider is unconfigured or unavailable.

Saving a complete target repeats that verification before persisting the existing target
fields used by the closed-Dashboard worker. A target or settings generation change
revokes active relay grants; automatic commits require renewed consent. A fresh
`RUNNING` worker lease is never reclaimed; only stale leases become terminal `UNKNOWN`.

## Memory migration

V5 preserves `solutions.memory_usage` for compatibility. It never assigns a unit to
that legacy number. New captures use `memory_value` plus `memory_unit` (`KB`, `KiB`,
`MB`, `MiB`, `UNKNOWN`); UI renders legacy values as `단위 미확인`.
Programmers' authoritative result row supplies MB. The supported SWEA solving page
does not expose an authoritative metric row locally, so its captures intentionally
remain `UNKNOWN` rather than guessing KB.

## Verification

The Issue #241 follow-up checks completed on the feature branch: Dashboard Vitest
reports 52 passing tests, Extension Node tests report 63 passing tests, and the Java
17 Temurin Maven container reports 49 tests passing (5 PostgreSQL-only migration
tests skipped). Both Dashboard and MV3 Extension typechecks and production builds
pass; `git diff --check` reports no whitespace errors.
